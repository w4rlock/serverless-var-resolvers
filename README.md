<p align="center">
  <img height="320px" alt="Extends-var-resolver" src="https://user-images.githubusercontent.com/621906/78961176-fb82fb80-7ac6-11ea-8a0f-f3278cb9cc01.png">
</p>

![serverless](http://public.serverless.com/badges/v3.svg)
[![npm version](https://badge.fury.io/js/serverless-vars-resolver.svg)](https://badge.fury.io/js/serverless-vars-resolver)
[![npm downloads](https://img.shields.io/npm/dt/serverless-vars-resolver.svg?style=flat)](https://www.npmjs.com/package/serverless-vars-resolver)

### Installation
```bash
npm i -E serverless-vars-resolver
```

### Resolvers
```yaml
- Acm-Certifate-Arn
- Route53-Hosted-Zone-Id
```

### Simple Usage

```yaml
plugins:
  - serverless-vars-resolver

custom:
  domainName: dev.mi.aws.domain
  certificateArn: ${aws-acm-arn:${self:custom.domainName}}
  zoneId: ${aws-zone-id:${self:custom.domainName}}
```


### Usage with vault integration to set aws credentials.

```yaml
plugins:
  - serverless-vars-resolver
  - serverless-vault-custom-plugin               # optional

custom:
  vault:
    host: vault.your.corp.com
    debugQuery: false                            # optional, log request query
    auth:
      # option 1
      roleId: 'xxx-xxxx-xxxxx-xx'                # optional, (use ssm to stored)
      secretId: 'xx-xxx-xx-x-xxx'                # optional, (use ssm to stored)

      # option 2
      useToken: ""                               # optional, use this token

    aws:
      setEnvVars: true
      secretPath: '/mi/dev/aws/creds'


  varsResolver:                                  # optional tag.
    before:                                      # before start to resolve vars
      spawn: 'vault:auth:aws'                    # set aws creds

  domainName: dev.mi.aws.domain
  certificateArn: ${aws-acm-arn:${self:custom.domainName}}
  zoneId: ${aws-zone-id:${self:custom.domainName}}
```
