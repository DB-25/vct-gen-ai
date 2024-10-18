import { ApiGatewayManagementApiClient, PostToConnectionCommand, DeleteConnectionCommand } from '@aws-sdk/client-apigatewaymanagementapi';
import { BedrockAgentRuntimeClient, RetrieveCommand as KBRetrieveCommand } from "@aws-sdk/client-bedrock-agent-runtime";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda"
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  QueryExecutionState,
  GetQueryResultsCommand,
} from '@aws-sdk/client-athena';
import { readFile } from 'fs/promises';
import ClaudeModel from "./models/claude3Sonnet.mjs";
import Mistral7BModel from "./models/mistral7b.mjs"

/*global fetch*/

const ENDPOINT = process.env.WEBSOCKET_API_ENDPOINT;
const SYS_PROMPT = process.env.PROMPT;
const wsConnectionClient = new ApiGatewayManagementApiClient({ endpoint: ENDPOINT });

const ATHENA_OUTPUT_BUCKET = "s3://riot-unzipped/athena-results/"  // S3 bucket where Athena will put the results
const DATABASE = 'default-db'  // The name of the database in Athena

let agents = JSON.parse(await readFile("agents.json", "utf8"));
  
export async function runQuery(query) {
  const client = new AthenaClient();

  const params = {
    QueryString: query, // Replace with your query
    ResultConfiguration: {
      OutputLocation: ATHENA_OUTPUT_BUCKET, // Replace with your S3 output location
    },
    QueryExecutionContext: {
        Database: DATABASE,
        // Catalog: this.catalog,
      },

  };

  try {
    const startQueryExecutionCommand = new StartQueryExecutionCommand(params);
    const startQueryResponse = await client.send(startQueryExecutionCommand);

    const queryExecutionId = startQueryResponse.QueryExecutionId;

    let getQueryResponse = {}
    // Poll for query completion
    let queryStatus = "RUNNING";
    while (queryStatus === "RUNNING" || queryStatus === "QUEUED") {
      const getQueryExecutionCommand = new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId,
      });
      getQueryResponse = await client.send(getQueryExecutionCommand);
      queryStatus = getQueryResponse.QueryExecution.Status.State;

      if (queryStatus === "FAILED" || queryStatus === "CANCELLED") {
        throw new Error(`Query failed: ${getQueryResponse.QueryExecution.Status.StateChangeReason}`);
      }

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1 second before polling again
    }

    // Query is successful
    // console.log("Query results available at:", getQueryResponse.QueryExecution.ResultConfiguration.OutputLocation);
    const getQueryResultsCommand = new GetQueryResultsCommand({
      QueryExecutionId : queryExecutionId,
    });
    const response = await client.send(getQueryResultsCommand);

    const resultSet = response.ResultSet;

    const mappedData = [];

    const columns = resultSet.Rows[0].Data.map((column) => {
      return column.VarCharValue;
    });

    resultSet.Rows.forEach((item, i) => {
      if (i === 0) {
        return;
      }

      const mappedObject = {};
      item.Data.forEach((value, i) => {
        if (value.VarCharValue) {
          mappedObject[columns[i]] = value.VarCharValue;
        } else {
          mappedObject[columns[i]] = '';
        }
      });

      mappedData.push(mappedObject);
    });

    return mappedData;

  } catch (err) {
    console.error("Error running query:", err);
  }
}

async function retrievePlayers(tournament, sortBy = "games_played") {  
  const QUERY = `
  select player_name, sum(total_kills) as total_kills, sum(total_deaths) as total_deaths,
  sum(games_played) as games_played, avg(average_kills) as average_kills,
  avg(average_deaths) as average_deaths
  from vct_stats_db
  where tournament = '${tournament}'
  group by 
  player_name
  order by
  ${sortBy} desc
  limit 30;
  `
  const result = await runQuery(QUERY)
  return result.map(player => {
      return `Player: ${player.player_name},  Avg Kills: ${player.average_kills}, Avg Assists: ${player.average_assists}, Avg Deaths: ${player.average_deaths}, Avg Score: ${player.avg_score}, KDR: ${player.kdr}, Games Played: ${player.games_played}`;
  }).join('\n');
}

function replaceUUIDsWithAgentNames(playerData, agentData) {
  // Create a map of UUIDs to agent names
  const agentMap = agentData.data.reduce((map, agent) => {
      map[agent.uuid.toUpperCase()] = agent.displayName;
      return map;
  }, {});

  // Replace UUIDs in player data with agent names
  return playerData.map(player => {
      const agentName = agentMap[player.agent_name] || player.agent_name; // Default to the UUID if not found
      return {
          ...player,
          agent_name: agentName // Replace the UUID with the agent name
      };
  });
}

async function retrievePlayerInfo(playerID) {
  const QUERY = `
  select *
  from vct_stats_db
  where player_name = '${playerID}'  
  `
  let result = await runQuery(QUERY);
  result = replaceUUIDsWithAgentNames(result,agents);
  return result.map(player => {
      return `Player: ${player.player}, Agent Name: ${player.agent_guid}, Avg Kills: ${player.average_kills}, Avg Assists: ${player.average_assists}, Avg Deaths: ${player.average_deaths}, Avg Score: ${player.avg_score}, KDR: ${player.kdr}, Games Played: ${player.games_played}`;
  }).join('\n');

}

/* Use the Bedrock Knowledge Base*/
async function retrieveKBDocs(query, knowledgeBase, knowledgeBaseID) {
  const input = { // RetrieveRequest
    knowledgeBaseId: knowledgeBaseID, // required
    retrievalQuery: { // KnowledgeBaseQuery
      text: query, // required
    }
  }


  try {
    const command = new KBRetrieveCommand(input);
    const response = await knowledgeBase.send(command);

    // filter the items based on confidence, we do not want LOW confidence results
    const confidenceFilteredResults = response.retrievalResults.filter(item =>
      item.score > 0.5
    )
    // console.log(confidenceFilteredResults)
    let fullContent = confidenceFilteredResults.map(item => item.content.text).join('\n');
    const documentUris = confidenceFilteredResults.map(item => {
      return { title: item.location.s3Location.uri.slice((item.location.s3Location.uri).lastIndexOf("/") + 1) + " (Bedrock Knowledge Base)", uri: item.location.s3Location.uri }
    });

    // removes duplicate sources based on URI
    const flags = new Set();
    const uniqueUris = documentUris.filter(entry => {
      if (flags.has(entry.uri)) {
        return false;
      }
      flags.add(entry.uri);
      return true;
    });

    // console.log(fullContent);

    //Returning both full content and list of document URIs
    if (fullContent == '') {
      fullContent = `No knowledge available! This query is likely outside the scope of your knowledge.
      Please provide a general answer but do not attempt to provide specific details.`
      console.log("Warning: no relevant sources found")
    }

    return {
      content: fullContent,
      uris: uniqueUris
    };
  } catch (error) {
    console.error("Caught error: could not retreive Knowledge Base documents:", error);
    // return no context
    return {
      content: `No knowledge available! There is something wrong with the search tool. Please tell the user to submit feedback.
      Please provide a general answer but do not attempt to provide specific details.`,
      uris: []
    };
  }
}

async function returnTeamJSON(teamData,id) {
  
  let jsonModel = new ClaudeModel();
  const jsonModelSystemPrompt = ```
    You will be given another LLM's description of a Valorant team. Please
    take that LLM's description of a team (it'll be 5 players), return a JSON object
    that represents that team's data. Only return the JSON, do not say anything like "sure here's your JSON"
    I want to directly parse your raw output.
  ```
  const jsonResponse = jsonModel.getResponse(jsonModelSystemPrompt,[],"Based on this response, return a JSON object representing a team.".concat(teamData))
  let responseParams = {
    ConnectionId: id,
    Data: "<TEAM_INFO>"
  }  
  let command = new PostToConnectionCommand(responseParams);

  try {
    await wsConnectionClient.send(command);
  } catch (error) {
    console.error("Error sending chunk:", error);
  }

  responseParams = {
    ConnectionId: id,
    Data: jsonResponse
  }  
  command = new PostToConnectionCommand(responseParams);

  try {
    await wsConnectionClient.send(command);
  } catch (error) {
    console.error("Error sending chunk:", error);
  }
}

const getUserResponse = async (id, requestJSON) => {
  try {
    const data = requestJSON.data;

    let userMessage = data.userMessage;
    const userId = data.user_id;
    const sessionId = data.session_id;
    const chatHistory = data.chatHistory;

    const knowledgeBase = new BedrockAgentRuntimeClient({ region: 'us-east-1' });

    if (!process.env.KB_ID) {
      throw new Error("Knowledge Base ID is not found.");
    }

    // retrieve a model response based on the last 5 messages
    // messages come paired, so that's why the slice is only 2 (2 x 2 + the latest prompt = 5)
    let claude = new ClaudeModel();
    let lastFiveMessages = chatHistory.slice(-2);

    let stopLoop = false;
    let modelResponse = ''

    let history = claude.assembleHistory(lastFiveMessages, "Please answer this new question. Enclose thought processes in <thinking> tags. Make sure not to include".concat(userMessage))
    let fullDocs = { "content": "", "uris": [] }

    while (!stopLoop) {
      console.log("started new stream")
      // console.log(lastFiveMessages)
      // console.log(history)
      history.forEach((historyItem) => {
        console.log(historyItem)
      })
      const stream = await claude.getStreamedResponse(SYS_PROMPT, history);
      try {
        // store the full model response for saving to sessions later

        let toolInput = "";
        let assemblingInput = false
        let usingTool = false;
        let toolId;
        let skipChunk = true;
        // this is for when the assistant uses a tool
        let message = {};
        // this goes in that message
        let toolUse = {}

        // iterate through each chunk from the model stream
        for await (const event of stream) {
          const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          const parsedChunk = await claude.parseChunk(chunk);
          if (parsedChunk) {

            // this means that we got tool use input or stopped generating text
            if (parsedChunk.stop_reason) {
              if (parsedChunk.stop_reason == "tool_use") {
                assemblingInput = false;
                usingTool = true;
                skipChunk = true;
              } else {
                stopLoop = true;
                break;
              }
            }

            // this means that we are collecting tool use input
            if (parsedChunk.type) {
              if (parsedChunk.type == "tool_use") {
                assemblingInput = true;
                toolId = parsedChunk.id
                message['role'] = 'assistant'
                message['content'] = []
                toolUse['name'] = parsedChunk.name;
                toolUse['type'] = 'tool_use'
                toolUse['id'] = toolId;
                toolUse['input'] = {}
              }
            }


            if (usingTool) {

              // get the full block of context from knowledge base
              let docString;
              console.log("tool input")
              console.log(toolInput);
              toolUse.input = JSON.parse(toolInput);                             
              let toolResult = {}

              if (toolUse.name == "query_db") {

                console.log("using knowledge bases!")
                docString = await retrieveKBDocs(toolUse.input.query, knowledgeBase, process.env.KB_ID);
                fullDocs.content = fullDocs.content.concat(docString.content)
                fullDocs.uris = fullDocs.uris.concat(docString.uris)
                
                toolResult = docString.content;
              } else if (toolUse.name == "list_players") {
                console.log("listing players!")
                const players = await retrievePlayers(toolUse.input.tournament, toolUse.input.sort_by)
                toolResult = players;
              } else if (toolUse.name == "player_info") {
                console.log("listing players!")
                const player = await retrievePlayerInfo(toolUse.input.player_handle)
                toolResult = player;
              } else if (toolUse.name == "return_json") {
                console.log("returning json")
                await returnTeamJSON(toolUse.input.team_data,modelResponse,id);
                break;
              }
              
              // add the tool use message to chat history
              message.content.push(toolUse)
              history.push(message)

              // add the tool response to chat history
              let toolResponse = {
                "role": "user",
                "content": [
                  {
                    "type": "tool_result",
                    "tool_use_id": toolId,
                    "content": toolResult
                  }
                ]
              };

              history.push(toolResponse);

              usingTool = false;
              toolInput = ""

              console.log("correctly used tool!")

            } else {

              if (assemblingInput & !skipChunk) {
                toolInput = toolInput.concat(parsedChunk);
                // toolUse.input.query += parsedChunk;
              } else if (!assemblingInput) {
                // console.log('writing out to user')
                let responseParams = {
                  ConnectionId: id,
                  Data: parsedChunk.toString()
                }
                modelResponse = modelResponse.concat(parsedChunk)
                let command = new PostToConnectionCommand(responseParams);

                try {
                  await wsConnectionClient.send(command);
                } catch (error) {
                  console.error("Error sending chunk:", error);
                }
              } else if (skipChunk) {
                skipChunk = false;
              }
            }



          }
        }

      } catch (error) {
        console.error("Stream processing error:", error);
        let responseParams = {
          ConnectionId: id,
          Data: `<!ERROR!>: ${error}`
        }
        let command = new PostToConnectionCommand(responseParams);
        await wsConnectionClient.send(command);
      }

    }

    let command;
    let links = JSON.stringify(fullDocs.uris)
    // send end of stream message
    try {
      let eofParams = {
        ConnectionId: id,
        Data: "!<|EOF_STREAM|>!"
      }
      command = new PostToConnectionCommand(eofParams);
      await wsConnectionClient.send(command);

      // send sources
      let responseParams = {
        ConnectionId: id,
        Data: links
      }
      command = new PostToConnectionCommand(responseParams);
      await wsConnectionClient.send(command);
    } catch (e) {
      console.error("Error sending EOF_STREAM and sources:", e);
    }


    const sessionRequest = {
      body: JSON.stringify({
        "operation": "get_session",
        "user_id": userId,
        "session_id": sessionId
      })
    }
    const client = new LambdaClient({});
    const lambdaCommand = new InvokeCommand({
      FunctionName: process.env.SESSION_HANDLER,
      Payload: JSON.stringify(sessionRequest),
    });

    const { Payload, LogResult } = await client.send(lambdaCommand);
    const result = Buffer.from(Payload).toString();

    // Check if the request was successful
    if (!result) {
      throw new Error(`Error retriving session data!`);
    }

    // Parse the JSON
    let output = {};
    try {
      const response = JSON.parse(result);
      output = JSON.parse(response.body);
      console.log('Parsed JSON:', output);
    } catch (error) {
      console.error('Failed to parse JSON:', error);
      let responseParams = {
        ConnectionId: id,
        Data: '<!ERROR!>: Unable to load past messages, please retry your query'
      }
      command = new PostToConnectionCommand(responseParams);
      await wsConnectionClient.send(command);
      return; // Optional: Stop further execution in case of JSON parsing errors
    }

    // Continue processing the data
    const retrievedHistory = output.chat_history;
    let operation = '';
    let title = ''; // Ensure 'title' is initialized if used later in your code

    // Further logic goes here

    let newChatEntry = { "user": userMessage, "chatbot": modelResponse, "metadata": links };
    if (retrievedHistory === undefined) {
      operation = 'add_session';
      let titleModel = new Mistral7BModel();
      const CONTEXT_COMPLETION_INSTRUCTIONS =
        `<s>[INST]Generate a concise title for this chat session based on the initial user prompt and response. The title should succinctly capture the essence of the chat's main topic without adding extra content.[/INST]
      [INST]${userMessage}[/INST]
      ${modelResponse} </s>
      Here's your session title:`;
      title = await titleModel.getPromptedResponse(CONTEXT_COMPLETION_INSTRUCTIONS, 25);
      title = title.replaceAll(`"`, '');
    } else {
      operation = 'update_session';
    }

    const sessionSaveRequest = {
      body: JSON.stringify({
        "operation": operation,
        "user_id": userId,
        "session_id": sessionId,
        "new_chat_entry": newChatEntry,
        "title": title
      })
    }

    const lambdaSaveCommand = new InvokeCommand({
      FunctionName: process.env.SESSION_HANDLER,
      Payload: JSON.stringify(sessionSaveRequest),
    });

    // const { SessionSavePayload, SessionSaveLogResult } = 
    await client.send(lambdaSaveCommand);

    const input = {
      ConnectionId: id,
    };
    await wsConnectionClient.send(new DeleteConnectionCommand(input));

  } catch (error) {
    console.error("Error:", error);
    let responseParams = {
      ConnectionId: id,
      Data: `<!ERROR!>: ${error}`
    }
    let command = new PostToConnectionCommand(responseParams);
    await wsConnectionClient.send(command);
  }
}

export const handler = async (event) => {
  if (event.requestContext) {
    const connectionId = event.requestContext.connectionId;
    const routeKey = event.requestContext.routeKey;
    let body = {};
    try {
      if (event.body) {
        body = JSON.parse(event.body);
      }
    } catch (err) {
      console.error("Failed to parse JSON:", err)
    }
    console.log(routeKey);

    switch (routeKey) {
      case '$connect':
        console.log('CONNECT')
        return { statusCode: 200 };
      case '$disconnect':
        console.log('DISCONNECT')
        return { statusCode: 200 };
      case '$default':
        console.log('DEFAULT')
        return { 'action': 'Default Response Triggered' }
      case "getChatbotResponse":
        console.log('GET CHATBOT RESPONSE')
        await getUserResponse(connectionId, body)
        return { statusCode: 200 };
      default:
        return {
          statusCode: 404,  // 'Not Found' status code
          body: JSON.stringify({
            error: "The requested route is not recognized."
          })
        };
    }
  }
  return {
    statusCode: 200,
  };
};