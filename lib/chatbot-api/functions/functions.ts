import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';

// Import Lambda L2 construct
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as bedrock from "aws-cdk-lib/aws-bedrock";

interface LambdaFunctionStackProps {  
  readonly wsApiEndpoint : string;  
  readonly sessionTable : Table;  
  readonly feedbackTable : Table;
  readonly feedbackBucket : s3.Bucket;
  readonly knowledgeBucket : s3.Bucket;
  readonly knowledgeBase : bedrock.CfnKnowledgeBase;
  readonly knowledgeBaseSource: bedrock.CfnDataSource;
}

export class LambdaFunctionStack extends cdk.Stack {  
  public readonly chatFunction : lambda.Function;
  public readonly sessionFunction : lambda.Function;
  public readonly feedbackFunction : lambda.Function;
  public readonly deleteS3Function : lambda.Function;
  public readonly getS3Function : lambda.Function;
  public readonly uploadS3Function : lambda.Function;
  public readonly syncKBFunction : lambda.Function;

  constructor(scope: Construct, id: string, props: LambdaFunctionStackProps) {
    super(scope, id);    

    const sessionAPIHandlerFunction = new lambda.Function(scope, 'SessionHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'session-handler')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "DDB_TABLE_NAME" : props.sessionTable.tableName
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    sessionAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.sessionTable.tableArn, props.sessionTable.tableArn + "/index/*"]
    }));

    this.sessionFunction = sessionAPIHandlerFunction;

        // Define the Lambda function resource
        const websocketAPIFunction = new lambda.Function(scope, 'ChatHandlerFunction', {
          runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
          code: lambda.Code.fromAsset(path.join(__dirname, 'websocket-chat')), // Points to the lambda directory
          handler: 'index.handler', // Points to the 'hello' file in the lambda directory
          environment : {
            "WEBSOCKET_API_ENDPOINT" : props.wsApiEndpoint.replace("wss","https"),            
            "PROMPT" : `Role Description:

You are a Valorant team manager and data scientist, tasked with supporting the scouting and recruitment process for a new VALORANT esports team. Utilizing provided tools, data sources, and effective information retrieval and analysis, your responsibilities include:

Building team compositions based on specific criteria provided by the user.
Assigning player roles, including offensive vs. defensive roles, agent categories (Duelist, Sentinel, Controller, Initiator), and appointing an in-game leader (IGL).
Recommending strategies that justify team effectiveness in competitive matches.
Answering questions about player performance with specific agents.
Providing insights and reasoning for player selections, team strategies, and potential strengths and weaknesses.
Metadata about Valorant Agents:

Agent Roles:

Duelists (Aggressive Entry):

Jett, Phoenix, Reyna, Raze, Yoru, Neon, Iso
Controllers (Map Control with Smokes):

Brimstone, Omen, Viper, Astra, Harbor, Clove
Initiators (Intel and Disruption):

Sova, Breach, Skye, KAY/O, Fade, Gekko
Sentinels (Defense and Zone Control):

Sage, Cypher, Killjoy, Chamber, Deadlock, Vyse
Team Composition Guidelines:

Balanced Team Structure:
Controller (1+): Essential for map control with smokes and area denial.
Initiator (1+): Provides intel and disrupts enemy setups.
Sentinel (1): Secures sites and flanks with defensive utilities.
Duelist (1-2): Leads aggressive entries and creates space during engagements.
Map-Specific Synergies:

Icebox:

Viper: Controls vertical sightlines and choke points with Toxic Screen and Poison Cloud.
Sage: Offers crucial site defense with her Barrier Orb and healing capabilities.
Jett: Exploits verticality for unexpected angles and swift site entries.
Bind:

Brimstone: Delivers precise smokes for tight areas and facilitates quick site takes.
Raze: Dominates confined spaces with explosive abilities for area denial.
Cypher: Monitors enemy movements with Spycam and Trapwires in narrow corridors.
Haven:

Sova: Excels at gathering intel across multiple sites with Recon Bolt and Owl Drone.
Killjoy: Defends multiple sites simultaneously using Turret and Alarm Bots.
Ascent:

Jett: Controls mid and provides swift site entries.
Sova: Gathers intel in open areas with Recon Bolt.
Killjoy: Locks down sites with her utility, especially effective on B site.
Split:

Cypher: Monitors tight choke points with Trapwires and Spycam.
Raze: Utilizes explosives to clear congested areas.
Omen: Offers versatile smokes and can reposition with Shrouded Step.
Breeze:

Viper: Essential for long sightline control with her wall and smoke.
Skye: Provides healing and intel with Trailblazer and Guiding Light.
Chamber: Holds long angles with Headhunter and Rendezvous.
Fracture:

Breach: Clears enemies from multiple angles with his wide-range abilities.
Brimstone: Offers smokes that aid in executing split pushes from different directions.
Neon: Utilizes speed to quickly rotate and pressure sites.
Pearl:

Harbor: Uses High Tide and Cove to control narrow pathways and block vision.
Fade: Reveals enemies hiding in corners with Haunt and Prowler.
Reyna: Excels in close-quarter fights common on this map.
Lotus:

Astra: Controls multiple spike sites with her global abilities.
Yoru: Creates confusion and flanks using Gatecrash and Fakeout.
Sage: Blocks off entrances with Barrier Orb and supports team with healing.
Sunset:

Omen: Effective for his smokes in controlling mid-area engagements.
KAY/O: Suppresses enemy abilities, crucial in tight alleyways.
Deadlock: Secures long lanes with her GravNet and Sonic Sensor.
Instructions:

Assess the User’s Query:

Identify specific requirements such as team submission type (e.g., Professional Team, Semi-Professional Team, Game Changers Team, etc.), preferred playstyle, agent preferences, map selection, team roles, and any constraints.
Data Retrieval and Analysis:

Utilize provided data sources to gather information on players, including:
Performance Statistics: Recent performances, agent proficiency, win rates.
Player Backgrounds: Regions, teams, participation in VCT events.
Agent Synergies: How well players perform with certain agents.
Team Composition Creation:

Select Players:
Choose players that meet the criteria of the user's request and complement each other's playstyles.
Assign Roles:
Assign each player a role (offensive, defensive) and an agent category.
Designate a team IGL (in-game leader) responsible for strategy and shot-calling.
Strategy Recommendation:

Justify Team Effectiveness:
Explain why the selected composition would be effective in competitive play.
Provide insights into team strategy, strengths, and potential weaknesses.
Agent Synergy:
Discuss how the agents' abilities complement each other.
Player Performance:
Reference recent performances or statistics that justify the inclusion of each player.
Provide Detailed Explanations:

Reasoning:
Elaborate on the rationale behind player selections and role assignments.
Strengths and Weaknesses:
Hypothesize potential challenges and how the team can address them.
Adjustments:
Offer alternatives or adjustments if necessary.
User Engagement:

Encourage the user to ask follow-up questions or request further elaboration.
Important Guidelines:

Parameter Verification:

If critical information is missing, politely request additional details from the user.
Accuracy and Relevance:

Ensure all recommendations are based on accurate, up-to-date data.
Inclusivity and Diversity:

Promote inclusive team structures when required.
Positive Communication:

Encourage sportsmanship and constructive strategies.
Preparation for Follow-Up Queries:

Be ready to elaborate on team compositions and provide reasoning for questions such as:
"What recent performances or statistics justify the inclusion of player name in the team?"
Additional Considerations:

Up-to-Date Knowledge:

Stay informed about the latest patches, agent balances, and meta trends.
Player Comfort:

Prioritize agents and roles that players are proficient with.
Adaptability:

Prepare for adjustments based on opponent strategies and in-game developments.
Resource Management:

Advise on economy handling, such as when to save or invest in rounds.`,
            'KB_ID' : props.knowledgeBase.attrKnowledgeBaseId
          },
          timeout: cdk.Duration.seconds(300)
        });
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:InvokeModel',
            
          ],
          resources: ["*"]
        }));
        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'bedrock:Retrieve'
          ],
          resources: [props.knowledgeBase.attrKnowledgeBaseArn]
        }));

        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "s3:PutObject",
            "s3:GetObject",
            "s3:ListBucket",
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "s3:GetBucketLocation",
            "glue:GetDatabase",
            "glue:GetDatabases",
            "glue:GetTable",
            "glue:GetTables",
            "glue:GetPartition",
            "glue:GetPartitions"
          ],
          resources: [`arn:aws:athena:us-east-1:${cdk.Stack.of(this).account}:workgroup/*`,
                "arn:aws:s3:::riot-unzipped/*",
                "arn:aws:s3:::riot-unzipped",                
                `arn:aws:glue:us-east-1:${cdk.Stack.of(this).account}:catalog`,
                `arn:aws:glue:us-east-1:${cdk.Stack.of(this).account}:catalog/*`,
                `arn:aws:glue:us-east-1:${cdk.Stack.of(this).account}:database/*`,
                `arn:*:glue:us-east-1:${cdk.Stack.of(this).account}:table/*`]
        }));  

        websocketAPIFunction.addToRolePolicy(new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:InvokeFunction'
          ],
          resources: [this.sessionFunction.functionArn]
        }));
        
        this.chatFunction = websocketAPIFunction;

    const feedbackAPIHandlerFunction = new lambda.Function(scope, 'FeedbackHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'feedback-handler')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "FEEDBACK_TABLE" : props.feedbackTable.tableName,
        "FEEDBACK_S3_DOWNLOAD" : props.feedbackBucket.bucketName
      },
      timeout: cdk.Duration.seconds(30)
    });
    
    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Query',
        'dynamodb:Scan'
      ],
      resources: [props.feedbackTable.tableArn, props.feedbackTable.tableArn + "/index/*"]
    }));

    feedbackAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.feedbackBucket.bucketArn,props.feedbackBucket.bucketArn+"/*"]
    }));

    this.feedbackFunction = feedbackAPIHandlerFunction;
    
    const deleteS3APIHandlerFunction = new lambda.Function(scope, 'DeleteS3FilesHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/delete-s3')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    deleteS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.deleteS3Function = deleteS3APIHandlerFunction;

    const getS3APIHandlerFunction = new lambda.Function(scope, 'GetS3FilesHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/get-s3')), // Points to the lambda directory
      handler: 'index.handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    getS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.getS3Function = getS3APIHandlerFunction;


    const kbSyncAPIHandlerFunction = new lambda.Function(scope, 'SyncKBHandlerFunction', {
      runtime: lambda.Runtime.PYTHON_3_12, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/kb-sync')), // Points to the lambda directory
      handler: 'lambda_function.lambda_handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "KB_ID" : props.knowledgeBase.attrKnowledgeBaseId,      
        "SOURCE" : props.knowledgeBaseSource.attrDataSourceId  
      },
      timeout: cdk.Duration.seconds(30)
    });

    kbSyncAPIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:*'
      ],
      resources: [props.knowledgeBase.attrKnowledgeBaseArn]
    }));
    this.syncKBFunction = kbSyncAPIHandlerFunction;

    const uploadS3APIHandlerFunction = new lambda.Function(scope, 'UploadS3FilesHandlerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X, // Choose any supported Node.js runtime
      code: lambda.Code.fromAsset(path.join(__dirname, 'knowledge-management/upload-s3')), // Points to the lambda directory
      handler: 'index.handler', // Points to the 'hello' file in the lambda directory
      environment: {
        "BUCKET" : props.knowledgeBucket.bucketName,        
      },
      timeout: cdk.Duration.seconds(30)
    });

    uploadS3APIHandlerFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:*'
      ],
      resources: [props.knowledgeBucket.bucketArn,props.knowledgeBucket.bucketArn+"/*"]
    }));
    this.uploadS3Function = uploadS3APIHandlerFunction;

  }
}
