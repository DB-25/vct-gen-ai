# VCT Scout

VCT Scout is an AI assistant, powered by Amazon Bedrock. It streamlines team-building and player analysis, offering managers data-driven insights to optimize recruitment and strategy.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Deployment Instructions:

1. Change the constants in lib/constants.ts!
2. Deploy with `npm run build && npx cdk deploy [stack name from constants.ts]`
3. Configure Cognito using the CDK outputs
