import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  InvokeModelCommand
} from "@aws-sdk/client-bedrock-runtime";

export default class ClaudeModel{
  constructor() {
    this.client = new BedrockRuntimeClient({
      region: "us-east-1",
    });
    this.modelId = "anthropic.claude-3-5-sonnet-20240620-v1:0";
  }

  assembleHistory(hist, prompt) {
    var history = []
    hist.forEach((element) => {
      history.push({"role": "user", "content": [{"type": "text", "text": element.user}]});
      history.push({"role": "assistant", "content": [{"type": "text", "text": element.chatbot}]});
    });
    history.push({"role": "user", "content": [{"type": "text", "text": prompt}]});
    return history;
  }
  parseChunk(chunk) {
    // console.log(chunk)
    if (chunk.type == 'content_block_delta') {
      if (chunk.delta.type == 'text_delta') {
        return chunk.delta.text
      }
      if (chunk.delta.type == "input_json_delta") {
        return chunk.delta.partial_json
      }
    } else if (chunk.type == "content_block_start") {
      if (chunk.content_block.type == "tool_use"){
        return chunk.content_block
      }
    } else if (chunk.type == "message_delta") {
      if (chunk.delta.stop_reason == "tool_use") {
        return chunk.delta
      } 
      else {
        return chunk.delta
      }
    }
  }

  async getStreamedResponse(system, history) {
    
    const payload = {
      "anthropic_version": "bedrock-2023-05-31",
      "system": system,
      "max_tokens": 2048,
      "messages": history,
      "temperature": 0.01,
      "tools": [
        {
                "name": "query_db",
                "description": "Query a vector database for any Valorant-related information in your knowledge base. Try to use specific key words when possible. This contains general background information and not statistics.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The query you want to make to the vector database."
                        }
                    },
                    "required": [
                        "query"
                    ]
                }
              
          },
          {
                "name": "list_players",
                "description": "Query a database to retrieve a list of players and their stats in a specific tournament. This is the first tool to use when assembling a team or doing anything that requires info on player performance.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "sort_by": {
                            "type": "string",
                            "enum" : ["total_kills","total_deaths","games_played","average_kills","average_deaths"],
                            "description": "How you choose to sort the results. Different use cases may require different sorts. games_played is a reasonable default."
                        },
                        "tournament" : {
                          "type" : "string",
                          "enum" : ["vct-international","game-changers","vct-challengers"],
                          "description" : "The tournament you want to get the player data for. You can only specify one tournament, otherwise you will get data for all of them. Can be combined with agent_type if desired."
                        },
                        "agent_type" : {
                          "type" : "string",
                          "enum" : ["initiator","sentinel","duelist","controller"],
                          "description" : "The type of agent you are looking for. Only use this if you need a specific type of agent. The default search will return all types. Can be combined with tournament."
                        }

                    },
                    "required": [
                        "sort_by",                        
                    ]
                }
          },
          {
            "name": "player_info",
                "description": "Query a database to retrieve stats on a player for each Valorant Agent they use. This is necessary to provide details on a specific player.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "player_handle": {
                            "type": "string",
                            "description": "The player handle you want to search for."
                        }
                    },
                    "required": [
                        "player_handle"
                    ]
                }
          },
          {
  "name": "save_team_composition",
  "description": "Save the current team composition to the database for future reference. When you save make sure you save agent+player specific stats and not just player stats over all agents.  **Note: This should be the final tool used after assembling and finalizing the team composition.**",
  "input_schema": {
    "type": "object",
    "properties": {
      "team_composition": {
        "type": "object",
        "properties": {
          "players": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "name": { "type": "string" },
                "averageKills": { "type": "number" },
                "averageDeaths": { "type": "number" },
                "gamesPlayed": { "type": "number" },
                "agent": { "type": "string" },
                "role": { "type": "string" },
                "igl": { "type": "boolean" }
              },
              "required": ["name", "averageKills", "averageDeaths", "gamesPlayed", "agent", "role", "igl"]
            },
            "minItems": 5,
            "maxItems": 5,
            "description": "An array of 5 player objects."
          },
          "teamVersion": {
            "type": "number",
            "description": "The version number of the team composition."
          }
        },
        "required": ["players", "teamVersion"],
        "description": "The team composition data to be saved."
      }
    },
    "required": ["team_composition"]
  }
},{
  "name": "get_team_composition",
  "description": "Retrieve the saved team composition from the database. If updates are needed, increment the version number for future reference.",
  "input_schema": {
    "type": "object",
    "properties": {
    },
    "required": []
  }
}



      ],
    };

    try {
      const command = new InvokeModelWithResponseStreamCommand({ body: JSON.stringify(payload), contentType: 'application/json', modelId: this.modelId });
      const apiResponse = await this.client.send(command);
      return apiResponse.body
    } catch (e) {
      console.error("Caught error: model invoke error")
    }
    
  }
  
  async getResponse(system, history, message) {
    const hist = this.assembleHistory(history,message);
      const payload = {
      "anthropic_version": "bedrock-2023-05-31",
      "system": system,
      "max_tokens": 2048,
      "messages" : hist,
      "temperature" : 0,
      
      };
      // Invoke the model with the payload and wait for the API to respond.
      const modelId = "anthropic.claude-3-sonnet-20240229-v1:0";
      const command = new InvokeModelCommand({
        contentType: "application/json",
        body: JSON.stringify(payload),
        modelId,
      });
      const apiResponse = await this.client.send(command);
      console.log(new TextDecoder().decode(apiResponse.body));
      return JSON.parse(new TextDecoder().decode(apiResponse.body)).content[0].text;
  }
}

// module.exports = ClaudeModel;
