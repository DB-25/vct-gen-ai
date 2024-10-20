import
{
  Box,
  Button,
  Container,
  Popover,
  Spinner,
  StatusIndicator,
  TextContent,
  SpaceBetween,
  ButtonDropdown,
  Modal,
  FormField,
  Input,
  Select,
  Grid,
  ExpandableSection, // Import ExpandableSection
} from "@cloudscape-design/components";
import * as React from "react";
import { useState } from 'react';
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "../../styles/chat.module.scss";
import
{
  ChatBotConfiguration,
  ChatBotHistoryItem,
  ChatBotMessageType,
} from "./types";

import "react-json-view-lite/dist/index.css";
import "../../styles/app.scss";
import { useNotifications } from "../notif-manager";
import { Utils } from "../../common/utils";
import { CHATBOT_NAME, feedbackCategories, feedbackTypes } from '../../common/constants'
import { formatThinkingString, removeAngleBracketContent } from "./utils";

export interface ChatMessageProps
{
  message: ChatBotHistoryItem;
  onThumbsUp: () => void;
  onThumbsDown: ( feedbackTopic: string, feedbackType: string, feedbackMessage: string ) => void;
}

export default function ChatMessage( props: ChatMessageProps )
{
  const [loading, setLoading] = useState<boolean>( false );
  const [selectedIcon, setSelectedIcon] = useState<1 | 0 | null>( null );
  const { addNotification, removeNotification } = useNotifications();
  const [modalVisible, setModalVisible] = useState( false );
  const [selectedTopic, setSelectedTopic] = React.useState( { label: "Select a Topic", value: "1" } );
  const [selectedFeedbackType, setSelectedFeedbackType] = React.useState( { label: "Select a Problem", value: "1" } );
  const [value, setValue] = useState( "" );

  // const [selectedValorantPlayers, setSelectedValorantPlayers] = useState( [] )
  // console.log( selectedValorantPlayers )

  const content =
    props.message.content && props.message.content.length > 0
      ? props.message.content
      : "";

  const showSources = props.message.metadata?.Sources && ( props.message.metadata.Sources as any[] ).length > 0;

  // Function to parse the content and extract thinking segments
  function parseContent( content: string )
  {
    const segments = [];
    let customTagRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
    let lastIndex = 0;
    let match;

    while ( ( match = customTagRegex.exec( content ) ) !== null )
    {
      let [tagContent, tagName, tagInnerContent] = match;

      if ( match.index > lastIndex )
      {
        // Add text before the custom tag as normal text
        segments.push( {
          type: 'text',
          content: content.substring( lastIndex, match.index ),
        } );
      }

      // if ( tagName === "json_data" )
      // {
      //   const parsedPlayers = JSON.parse( JSON.stringify( tagInnerContent ) );
      //   setSelectedValorantPlayers( parsedPlayers?.players )
      // }

      // Add custom tag content
      segments.push( {
        type: "thinking",
        tagName: tagName,
        tagContent: tagContent,
        tagInnerContent: tagInnerContent,
      } );

      lastIndex = customTagRegex.lastIndex;
    }

    if ( lastIndex < content.length )
    {
      // Add remaining text
      segments.push( {
        type: 'text',
        content: content.substring( lastIndex ),
      } );
    }

    return segments;
  }

  const segments = parseContent( content );


  return (
    <div>
      <Modal
        onDismiss={() => setModalVisible( false )}
        visible={modalVisible}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" onClick={() =>
              {
                setModalVisible( false )
                setValue( "" )
                setSelectedTopic( { label: "Select a Topic", value: "1" } )
                setSelectedFeedbackType( { label: "Select a Topic", value: "1" } )
              }}
              >Cancel</Button>
              <Button variant="primary" onClick={() =>
              {
                if ( !selectedTopic.value || !selectedFeedbackType.value || selectedTopic.value === "1" || selectedFeedbackType.value === "1" || value.trim() === "" )
                {
                  const id = addNotification( "error", "Please fill out all fields." )
                  Utils.delay( 3000 ).then( () => removeNotification( id ) );
                  return;
                } else
                {
                  setModalVisible( false )
                  setValue( "" )

                  const id = addNotification( "success", "Your feedback has been submitted." )
                  Utils.delay( 3000 ).then( () => removeNotification( id ) );

                  props.onThumbsDown( selectedTopic.value, selectedFeedbackType.value, value.trim() );
                  setSelectedIcon( 0 );

                  setSelectedTopic( { label: "Select a Topic", value: "1" } )
                  setSelectedFeedbackType( { label: "Select a Problem", value: "1" } )

                }
              }}>Ok</Button>
            </SpaceBetween>
          </Box>
        }
        header="Provide Feedback"
      >
        <SpaceBetween size="xs">
          <Select
            selectedOption={selectedTopic}
            onChange={( { detail } ) => setSelectedTopic( { label: detail.selectedOption.label, value: detail.selectedOption.value } )}
            options={feedbackCategories}
          />
          <Select
            selectedOption={selectedFeedbackType}
            onChange={( { detail } ) => setSelectedFeedbackType( { label: detail.selectedOption.label, value: detail.selectedOption.value } )}
            options={feedbackTypes}
          />
          <FormField label="Please enter feedback here">
            <Input
              onChange={( { detail } ) => setValue( detail.value )}
              value={value}
            />
          </FormField>
        </SpaceBetween>
      </Modal>
      <div className="AIInteractionDiv">
        {props.message?.type === ChatBotMessageType.AI && (
          <Grid gridDefinition={[{ colspan: 1 }, { colspan: 10 }]}>
            <div>
              <img src="/svg/valorant-icon.svg" alt={CHATBOT_NAME} />
            </div>
            <div className="ChatTextContainer">
              <Container
                footer={
                  showSources && (
                    <SpaceBetween direction="horizontal" size="s">
                      <ButtonDropdown
                        items={( props.message.metadata.Sources as any[] ).map( ( item ) => { return { id: "id", disabled: false, text: item.title, href: item.uri, external: true, externalIconAriaLabel: "(opens in new tab)" } } )}

                      >Sources</ButtonDropdown>
                    </SpaceBetween>
                  )
                }
              >
                {content?.length === 0 ? (
                  <Box>
                    <Spinner />
                  </Box>
                ) : null}
                {/* {props.message.content.length > 0 ? (
                    <div className={styles.btn_chabot_message_copy}>
                      <Popover
                        size="medium"
                        position="top"
                        triggerType="custom"
                        dismissButton={false}
                        content={
                          <StatusIndicator type="success">
                            Copied to clipboard
                          </StatusIndicator>
                        }
                      >
                        <Button
                          variant="inline-icon"
                          iconName="copy"
                          onClick={() => {
                            navigator.clipboard.writeText(props.message.content);
                          }}
                        />
                      </Popover>
                    </div>
                  ) : null} */}
                {/* Render the segments */}
                {segments.map( ( segment, index ) =>
                {
                  if ( segment.type === 'text' )
                  {
                    return (
                      <ReactMarkdown
                        key={index}
                        children={segment.content.replace( segment?.tagName, "" )}
                        remarkPlugins={[remarkGfm]}
                        components={{
                          pre( props )
                          {
                            const { children, ...rest } = props;
                            return (
                              <pre {...rest} className={styles.codeMarkdown}>
                                {children}
                              </pre>
                            );
                          },
                          table( props )
                          {
                            const { children, ...rest } = props;
                            return (
                              <table {...rest} className={styles.markdownTable}>
                                {children}
                              </table>
                            );
                          },
                          th( props )
                          {
                            const { children, ...rest } = props;
                            return (
                              <th {...rest} className={styles.markdownTableCell}>
                                {children}
                              </th>
                            );
                          },
                          td( props )
                          {
                            const { children, ...rest } = props;
                            return (
                              <td {...rest} className={styles.markdownTableCell}>
                                {children}
                              </td>
                            );
                          },
                        }}
                      />
                    );
                  } else if ( segment.type === 'thinking' )
                  {
                    return (
                      <div className="ThinkingContent">
                        <ExpandableSection key={index} headerText={formatThinkingString( segment?.tagName )}>
                          <ReactMarkdown
                            children={removeAngleBracketContent( segment?.tagInnerContent )}
                            remarkPlugins={[remarkGfm]}
                            components={{
                              pre( props )
                              {
                                const { children, ...rest } = props;
                                return (
                                  <pre {...rest} className={styles.codeMarkdown}>
                                    {children}
                                  </pre>
                                );
                              },
                              table( props )
                              {
                                const { children, ...rest } = props;
                                return (
                                  <table {...rest} className={styles.markdownTable}>
                                    {children}
                                  </table>
                                );
                              },
                              th( props )
                              {
                                const { children, ...rest } = props;
                                return (
                                  <th {...rest} className={styles.markdownTableCell}>
                                    {children}
                                  </th>
                                );
                              },
                              td( props )
                              {
                                const { children, ...rest } = props;
                                return (
                                  <td {...rest} className={styles.markdownTableCell}>
                                    {children}
                                  </td>
                                );
                              },
                            }}
                          />
                        </ExpandableSection>
                      </div>
                    );
                  }
                } )}
              </Container>
            </div>
          </Grid>
        )}
      </div>
      <div className="UserInteractionDiv">
        {props.message?.type === ChatBotMessageType.Human && (
          <Grid gridDefinition={[{ colspan: 3 }, { colspan: 8 }, { colspan: 2 }]}>
            <div></div>
            <div className="ChatTextContainer">
              <TextContent>
                <strong>{props.message.content}</strong>
              </TextContent>
            </div>
            <div></div>
          </Grid>
        )}
      </div>
      {loading && (
        <Box float="left">
          <Spinner />
        </Box>
      )}

    </div>
  );
}
