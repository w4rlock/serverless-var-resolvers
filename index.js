'use strict';

const _ = require('lodash');
const https = require('https');
const url = require('url');

const LOG_PREFFIX = '[ServerlessVarsResolver] - ';



class ServerlessPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.cachedVaultRequest = {};

    let disabled = this.getConfValue('varsResolve.disabled', false);
    if (disabled == 'true') {
      this.log('plugin disabled');
      return;
    }


    const _resolver = resolver => ({
      resolver,
      serviceName: 'VAULT',
      isDisabledAtPrepopulation: true
    });


    this.variableResolvers = {
      certificate: _resolver(this.resolveVarCertificateArn.bind(this)),
      hostedZoneId: _resolver(this.resolveVarHostedZoneId.bind(this))
    }



  async safeResolveVaultCredentials() {
    if (this.cachedVaultRequest.promise) {
      return this.cachedVaultRequest.promise;
    }

    this.cachedVaultRequest.promise = new Promise(async (resolve, reject) => {
      const resp = await this.vaultRequest(this.cfg);
      this.setEnvCredentialVars(resp);

      const region = this.serverless.providers.aws.getRegion() ;
      const creds = this.serverless.providers.aws.getCredentials();

      if (_.isEmpty(creds)) {
        reject('serverless credentials is empty');
      }
      else {
        this.cachedVaultRequest.creds = { ...creds, region }
        resolve(this.cachedVaultRequest.creds);
      }
    });

    return this.cachedVaultRequest.promise;
  }

  /**
   * Cachiing credentials
   *
   */
  async getAwsCredentials() {
    if (!_.isEmpty(this.cachedVaultRequest.creds)) {
      return this.cachedVaultRequest.creds;
    }

    const resp = await this.safeResolveVaultCredentials();
    return resp;
  }




  /**
   * Log to console
   * @param msg:string message to log
   */
  log(entity) {
    this.serverless.cli.log(
      LOG_PREFFIX + (_.isObject(entity) ? JSON.stringify(entity) : entity)
    );
  }




  /**
   *
   * Log to console if debug is enabled
   * @param msg:string message to log
   *
   */
  debug(msg) {
    if (process.env.SLS_DEBUG) {
      this.log(msg);
    }
  }



  /**
   * Get aws arn for ACM SSL certificate
   *
   */
  async getCertificateArn(certName) {
    let certificateArn

    this.initialize();

    const creds = await this.getAwsCredentials();
    const awsAcm = new this.serverless.providers.aws.sdk.ACM(creds);
    this.debug(`Fetching certificate arn id for certificate name "${certName}"`);


    try {
      const raw_certs = await awsAcm.listCertificates({}).promise();
      const certs = raw_certs.CertificateSummaryList;
      const cert = certs.find(crt => crt.DomainName.includes(certName));

      if (cert) {
        certificateArn = cert.CertificateArn
        this.log(`SSL Certificate arn: ${certificateArn}`);
      }
    }
    catch(err) {
      this.debug(err);
      throw new Error("could not fetch acm certificates list");
    }

    if (!certificateArn) {
      throw new Error(`arn certificate not found for domain "${certName}"`);
    }

    return certificateArn;
  }



  /**
   *
   * Get hosted zone id for subdomain name
   * @param
   *
   */
  async getHostedZoneId(domainName) {
    let zoneId

    this.initialize();

    const creds = await this.getAwsCredentials();
    this.awsRoute53 = new this.serverless.providers.aws.sdk.Route53(creds);
    this.debug(`Fetching hosted zone id for domain name "${domainName}"`);


    try {
      const zones = await this.awsRoute53.listHostedZones({}).promise();
      const hzone = zones.HostedZones.find(z => z.Name.includes(domainName));

      if (hzone) {
        zoneId = hzone.Id.split("/")[2];
      }
    }
    catch(err) {
      this.debug(err);
      throw new Error("could not fetch route53 HostedZones list");
    }

    if (!zoneId) {
      throw new Error("zone not found");
    }

    this.log("Zone id: " + zoneId);
    return zoneId;
  }







  getConfValue(key, required = true, default_value = undefined) {
    const fromEnv = k => process.env[k];
    const fromCmdArg = k => this.options[k];
    const fromYaml = k => _.get(this.serverless, `service.custom.${k}`);

    let val = fromCmdArg(`vault-${key}`);
    if (val) return val;

    val = fromEnv(`VAULT_${key}`.toUpperCase());
    if (val) return val;

    val = fromYaml(`vault.${key}`);
    if (val) return val;

    if (required && !default_value) {
      throw new Error(`property value for ${key} is missing.`)
    }

    return default_value;
  }




  initialize() {
    this.cfg = {}
    this.cfg.host = this.getConfValue('host');
    this.cfg.path = this.getConfValue('path');
    this.cfg.port = this.getConfValue('port', false, 443);
    this.cfg.token = this.getConfValue('token', false, process.env.TOKEN)

    //vault json responses key path configurables
    this.cfg.jsonAccessPath = this.getConfValue('jsonaccesspath', false, 'data.aws_access_key_id')
    this.cfg.jsonSecretPath = this.getConfValue('jsonsecretpath', false, 'data.aws_secret_access_key')

    if (!this.cfg.token) throw new Error('vault token is missing');
  }




  vaultRequest(config) {
    return new Promise((resolve, reject) => {
      const { host, path, token, port } = config;
      const opts = {
        port,
        path,
        hostname: host,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Vault-Token': token,
        },
      };

      this.log(`Fetching vault creds "${path}"`);
      const req = https.request(opts, res => {
        res.on('data', d => {
          const resp = JSON.parse(d);
          if (_.isEmpty(resp)) {
            reject('vault response is empty');
          }
          else {
            resolve(resp);
          }
        });
      });

      req.on('error', error => reject(error));
      req.end();
    });
  }





  setEnvCredentialVars(httpResponse) {
    process.env.AWS_ACCESS_KEY_ID = _.get(httpResponse, this.cfg.jsonAccessPath);
    process.env.AWS_SECRET_ACCESS_KEY = _.get(httpResponse, this.cfg.jsonSecretPath);
    this.log('Environment vault credentials setted');
  }





  /**
   *
   * Resolver certificate arn in serverless.yaml
   * Ex:
   *    custom:
   *      cert_arn: ${certificate:some.domain.name}
   *
   */
  resolveVarCertificateArn(src) {
    let [ kindvar, certName ] = src.split(':');
    return this.getCertificateArn(certName);
  }



  /**
   *
   * Resolver hosted zone id in serverless.yaml
   * Ex:
   *    custom:
   *      zone_id: ${hostedZoneId:some.domain.name}
   *
   */
  resolveVarHostedZoneId(src) {
    let [ kindvar, domainName ] = src.split(':');
    return this.getHostedZoneId(domainName);
  }
}


module.exports = ServerlessPlugin
