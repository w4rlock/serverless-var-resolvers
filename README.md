![serverless](http://public.serverless.com/badges/v3.svg)
[![npm version](https://badge.fury.io/js/serverless-vars-resolver.svg)](https://badge.fury.io/js/serverless-vars-resolver)
[![npm downloads](https://img.shields.io/npm/dt/serverless-vars-resolver.svg?style=flat)](https://www.npmjs.com/package/serverless-vars-resolver)

### Installation
```bash
npm i -E serverless-vars-resolver
```

### Usage

```yaml
plugins:
  - serverless-vars-resolver
  - serverless-vault-custom-plugin               # optional

custom:
  varsResolver:                                  # optional tag.
    before:                                      # before start to resolve vars
      spawn: 'vault:auth:aws'                    # call vault plugin to set aws creds

  vault:                                         # optional
    host: 'vault.corp.com'
    debugQuery: false                            # log axios request

    auth:
      roleId: ""                                 # take from ssm or something like that
      secretId: ""                               # take from ssm or something like that

      # Or force request to use this token
      useToken: ""

    aws:
      setEnvVars: true
      secretPath: /relative/path/to/aws/creds


  domainName: dev.mi.aws.domain

  rertificateArn: ${aws-acm-arn:${self:custom.domainName}}
  hostedZoneId: ${aws-zone-id:${self:custom.domainName}}
```
