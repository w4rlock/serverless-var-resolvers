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
   * Ex:
   *   certName: dev.some.domain
   *   certName: *.dev.some.domain
   *   certName: new.poc.dev.some.domain
   *
   * @param {string} certName or sub domain name to resolve
   * @returns {string} acm certificate arn
   */
  async getCertificateArn(certName) {
    // reduce risk for names
    const fixCertName = (crt) => {
      if (crt.startsWith('*.')) return crt.substring(2);
      if (crt.startsWith('.')) return crt.substring(1);
      return crt;
    };

    const inCertificate = fixCertName(certName);

    this.log(`Fetching certificate arn id for certificate name "${certName}"`);
    const acmCertsList = await this.fetchAcmCerts();

    const certs = acmCertsList.filter((crt) =>
      inCertificate.endsWith(fixCertName(crt.DomainName))
    );

    if (_.isEmpty(certs)) {
      let msg = '';
      msg += 'AWS_ACM_CERT_NOT_FOUND:';
      msg += `Could not found your certificate for domain "${certName}"`;
      msg += 'Please go to aws console => acm.. and review';
      throw new Error(msg);
    }

    // match with the most long cert for this new domain.
    const cert = certs.reduce((a, b) =>
      a.DomainName.length > b.DomainName.length ? a : b
    );

    const { CertificateArn } = cert;
    this.log(`SSL Certificate arn: ${CertificateArn}`);

    return CertificateArn;
  }

  /**
   * Fetch Aws Acm Certificate List
   *
   * @returns {array} Certificate List
   */
  async fetchAcmCerts() {
    const creds = this.getAwsCredentials();
    const awsAcm = new this.serverless.providers.aws.sdk.ACM(creds);
    let acmCerts;

    try {
      acmCerts = await awsAcm.listCertificates({}).promise();
    } catch (err) {
      throw new Error('AWS_ACM_CERTS: Could not fetch acm certificates list');
    }

    return acmCerts.CertificateSummaryList;
  }

  /**
   * Get hosted zone id for subdomain name
   *
   * @param {string} subdomain subdomain name
   * @returns {string } zone id
   */
  async getHostedZoneId(subdomain) {
    let zoneId;
    let newDomain = subdomain;

    if (newDomain.endsWith('.')) newDomain = newDomain.slice(0, -1);

    const creds = await this.getAwsCredentials();
    this.awsRoute53 = new this.serverless.providers.aws.sdk.Route53(creds);
    this.log(`Fetching hosted zone id for subdomain name "${subdomain}"`);

    try {
      const zones = await this.awsRoute53.listHostedZones({}).promise();
      const hzone = zones.HostedZones.find((z) => {
        let currentZone = z.Name;
        if (currentZone.endsWith('.')) currentZone = currentZone.slice(0, -1);
        return newDomain.includes(currentZone);
      });

      if (hzone) {
        [, , zoneId] = hzone.Id.split('/');
      }
    } catch (err) {
      throw new Error('Could not fetch route53 HostedZones list');
    }

    if (!zoneId) {
      let msg = '';

      msg += 'HOSTED_ZONE_NOT_FOUND:';
      msg += 'To create a route53 record is required a hosted zone.';
      msg += `You need to create a hosted zone from subdomain "${subdomain}". `;
      msg += 'Or check your subdomain name is right.';
      throw new Error(msg);
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
