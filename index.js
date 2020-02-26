'use strict';

class ServerlessPlugin {
  constructor(serverless, options) {
    this.logPreffix = '[ServerlessAwsUtils] - ';
    this.serverless = serverless;
    this.options = options;

    this.log('ServerlessPlugin constructor');


    const region = serverless.providers.aws.getRegion() ;
    const credentials = serverless.providers.aws.getCredentials()
    const acmCredentials = { ...credentials, region }


    /**
     * aws services
     */
    this.awsAcm = new serverless.providers.aws.sdk.ACM(acmCredentials);
    this.awsRoute53 = new serverless.providers.aws.sdk.Route53(credentials);


    /**
     *
     * Variables resolvers in serverless.yaml
     *
     * ${kind:some_obj_or_value}
     *
     */
    this.variableResolvers = {
      certificate: {
        resolver: this.resolveVarCertificateArn.bind(this),
        isDisabledAtPrepopulation: true,
        serviceName: 'depends before resolve'
      },
      hostedZoneId: {
        resolver: this.resolveVarHostedZoneId.bind(this),
        isDisabledAtPrepopulation: true,
        serviceName: 'depends before resolve'
      }
    }
  }


  /**
   * Log to console
   * @param msg:string message to log
   */
  log(msg) {
    this.serverless.cli.log(this.logPreffix + msg);
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
    this.log(`Looking for arn ssl certificate for domain ¨${certName}¨...`);


    try {

      const raw_certs = await this.awsAcm.listCertificates({ }).promise();
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
    this.debug(`Looking for host zone id  for domain ¨${domainName}¨...`);


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
