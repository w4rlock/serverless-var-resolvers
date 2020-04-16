const _ = require('lodash');
const BaseServerlessPlugin = require('base-serverless-plugin');

const LOG_PREFFIX = '[ServerlessVarsResolver] -';

class ServerlessVarsResolver extends BaseServerlessPlugin {
  constructor(serverless, options) {
    super(serverless, options, LOG_PREFFIX, 'varsResolver');
    this.cachedVaultRequest = {};

    const commonResolver = {
      serviceName: 'ServerlessVarsResolver',
      isDisabledAtPrepopulation: true,
    };

    this.variableResolvers = {
      'aws-acm-arn': {
        ...commonResolver,
        resolver: this.dispatchAction.bind(this, this.resolveAcmArn),
      },
      'aws-zone-id': {
        ...commonResolver,
        resolver: this.dispatchAction.bind(this, this.resolveZoneId),
      },
    };

    // when you need to resolve many vars into serverless.yml
    // this should run once
    // the idea is if need aws credentials run other plugin hook
    // to set environment vars. aws_secret_key etc.
    this.initialize = _.once(() => {
      this.loadConfig();
      const bs = _.get(this.cfg, 'before.spawn');
      if (!_.isEmpty(bs)) {
        return this.serverless.pluginManager.spawn(bs);
      }

      return Promise.resolve();
    });
  }

  /**
   * Load user config
   *
   */
  loadConfig() {
    this.cfg = {};
    this.cfg.before = {};
    this.cfg.before.spawn = this.getConf('before.spawn', false);
  }

  /**
   * Action Wrapper check plugin condition before perform action
   *
   * @param {function} funAction serverless plugin action
   */
  async dispatchAction(funAction, varResolver) {
    if (this.isPluginDisabled()) {
      this.log('warning: plugin is disabled');
      return '';
    }

    await this.initialize();
    const res = await funAction.call(this, varResolver);
    return res;
  }

  /**
   * Get aws credentials
   *
   */
  getAwsCredentials() {
    const region = this.serverless.providers.aws.getRegion();
    const creds = this.serverless.providers.aws.getCredentials();

    if (_.isEmpty(creds)) {
      throw new Error('Serverless credentials is empty');
    }

    return { ...creds, region };
  }

  /**
   * Get aws arn for ACM SSL certificate
   *
   * @param {string} certName cert name to resolve
   * @returns {string} acm certificate arn
   */
  async getCertificateArn(certName) {
    let certificateArn;

    const creds = this.getAwsCredentials();
    const awsAcm = new this.serverless.providers.aws.sdk.ACM(creds);
    this.log(`Fetching certificate arn id for certificate name "${certName}"`);

    try {
      const rawCerts = await awsAcm.listCertificates({}).promise();
      const certs = rawCerts.CertificateSummaryList;
      const cert = certs.find((crt) => crt.DomainName.includes(certName));

      if (cert) {
        certificateArn = cert.CertificateArn;
        this.log(`SSL Certificate arn: ${certificateArn}`);
      }
    } catch (err) {
      throw new Error('could not fetch acm certificates list');
    }

    if (!certificateArn) {
      throw new Error(`arn certificate not found for domain "${certName}"`);
    }

    return certificateArn;
  }

  /**
   * Get hosted zone id for subdomain name
   *
   * @param {string} domainName domain name
   * @returns {string } zone id
   */
  async getHostedZoneId(domainName) {
    let zoneId;

    const creds = await this.getAwsCredentials();
    this.awsRoute53 = new this.serverless.providers.aws.sdk.Route53(creds);
    this.log(`Fetching hosted zone id for domain name "${domainName}"`);

    try {
      const zones = await this.awsRoute53.listHostedZones({}).promise();
      const hzone = zones.HostedZones.find((z) => z.Name.includes(domainName));

      if (hzone) {
        [, , zoneId] = hzone.Id.split('/');
      }
    } catch (err) {
      throw new Error('could not fetch route53 HostedZones list');
    }

    if (!zoneId) {
      throw new Error('zone not found');
    }

    this.log(`Zone id: ${zoneId}`);
    return zoneId;
  }

  /**
   * Serverless variable resolver for certificates
   *
   * @param {string} src value to resolve
   * @returns {string} arn certificate
   */
  async resolveAcmArn(src) {
    let val = '';
    if (!_.isEmpty(src) && src.includes(':')) {
      const [, certName] = src.split(':');
      val = await this.getCertificateArn(certName);
    }
    return val;
  }

  /**
   * Serverless variable resolver for hosted zone
   *
   * @param {string} src value to resolve
   * @returns {string} hosted zone id
   */
  async resolveZoneId(src) {
    let val = '';
    if (!_.isEmpty(src) && src.includes(':')) {
      const [, zoneName] = src.split(':');
      val = await this.getHostedZoneId(zoneName);
    }
    return val;
  }
}

module.exports = ServerlessVarsResolver;
