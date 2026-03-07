import * as core from '@actions/core';
import * as fs from 'fs';

const DEFAULT_BASE_URL = 'https://dashboard.quantcdn.io/api/v3';

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('quant_api_key', { required: true });
    const organization = core.getInput('quant_organization', { required: true });
    const agentId = core.getInput('agent_id', { required: true });
    const testFixturesPath = core.getInput('test_fixtures');
    const userMessageInput = core.getInput('user_message');
    const userMessageFile = core.getInput('user_message_file');

    let userMessage = 'Begin assessment.';
    if (userMessageFile) {
      try {
        const inputContent = fs.readFileSync(userMessageFile, 'utf-8');
        const inputData = JSON.parse(inputContent);
        userMessage = typeof inputData.message === 'string'
          ? inputData.message
          : JSON.stringify(inputData.message);
        core.info(`Loaded user message from ${userMessageFile}`);
      } catch (err) {
        core.setFailed(`Failed to read user message file: ${err}`);
        return;
      }
    } else if (userMessageInput) {
      userMessage = userMessageInput;
    }
    const timeout = parseInt(core.getInput('timeout') || '300', 10);
    const baseUrl = core.getInput('base_url') || DEFAULT_BASE_URL;

    // Load tool fixtures
    let toolFixtures: Record<string, any> = {};
    if (testFixturesPath) {
      try {
        const content = fs.readFileSync(testFixturesPath, 'utf-8');
        const parsed = JSON.parse(content);
        toolFixtures = parsed.tool_fixtures || parsed;
      } catch (err) {
        core.setFailed(`Failed to read tool fixtures: ${err}`);
        return;
      }
    }

    // Dispatch agent test run via portal endpoint
    core.info(`Dispatching agent ${agentId} in test mode...`);

    const dispatchUrl = `${baseUrl}/organizations/${organization}/agents/${agentId}/test-runs`;
    const dispatchBody = {
      message: userMessage,
      toolFixtures,
    };

    const dispatchResponse = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(dispatchBody),
    });

    if (dispatchResponse.status !== 202) {
      const errorBody = await dispatchResponse.text();
      core.setFailed(`Agent dispatch failed (${dispatchResponse.status}): ${errorBody}`);
      return;
    }

    const dispatchResult = await dispatchResponse.json() as {
      testRunId: string;
      pollUrl: string;
    };

    core.info(`Agent dispatched. Test run ID: ${dispatchResult.testRunId}`);
    core.info(`Polling for completion (timeout: ${timeout}s)...`);

    // Poll for completion using the pollUrl from the response
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    let completed = false;
    let finalResult: any = null;

    while (Date.now() - startTime < timeout * 1000) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      // pollUrl is a relative path — resolve against baseUrl origin
      const baseOrigin = new URL(baseUrl).origin;
      const pollUrl = `${baseOrigin}${dispatchResult.pollUrl}`;
      const pollResponse = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!pollResponse.ok) {
        core.warning(`Poll request failed: ${pollResponse.status}`);
        continue;
      }

      const pollResult = await pollResponse.json() as {
        status: string;
        result?: any;
        toolCalls?: any[];
        error?: string;
      };

      if (pollResult.status === 'complete' || pollResult.status === 'completed') {
        completed = true;
        finalResult = pollResult;
        break;
      } else if (pollResult.status === 'failed') {
        core.setFailed(`Agent execution failed: ${pollResult.error || 'Unknown error'}`);
        return;
      }

      core.info(`  Status: ${pollResult.status}...`);
    }

    if (!completed) {
      core.setFailed(`Agent execution timed out after ${timeout}s`);
      return;
    }

    // Extract outputs — result is nested under finalResult.result
    const resultData = finalResult.result || {};
    const toolExecutions = resultData.toolExecutions || [];
    const conversationContext = {
      tool_calls: toolExecutions.map((t: any) => ({
        name: t.name,
        input: t.input,
        result: t.result,
      })),
    };

    // Structure agent_output so the portal validation controller can extract
    // the final tool call via agent_output.tool_call.parameters
    const lastToolCall = toolExecutions.length > 0
      ? toolExecutions[toolExecutions.length - 1]
      : null;
    const agentOutput = lastToolCall
      ? {
          tool_call: {
            name: lastToolCall.name,
            parameters: lastToolCall.result || lastToolCall.input || {},
          },
          response: resultData.response,
        }
      : resultData;

    // Write outputs to files to avoid "Argument list too long" with large responses
    const outputDir = process.env.RUNNER_TEMP || '/tmp';
    const agentOutputPath = `${outputDir}/agent-output-${Date.now()}.json`;
    const contextPath = `${outputDir}/conversation-context-${Date.now()}.json`;

    fs.writeFileSync(agentOutputPath, JSON.stringify(agentOutput));
    fs.writeFileSync(contextPath, JSON.stringify(conversationContext));

    // Set file paths as outputs (primary)
    core.setOutput('agent_output_file', agentOutputPath);
    core.setOutput('conversation_context_file', contextPath);
    // Also set JSON string outputs for backwards compatibility (may fail with large outputs)
    core.setOutput('agent_output', JSON.stringify(agentOutput));
    core.setOutput('conversation_context', JSON.stringify(conversationContext));
    core.setOutput('execution_id', dispatchResult.testRunId);

    core.info(`Agent completed successfully. Output written to ${agentOutputPath}`);
  } catch (error) {
    core.setFailed(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run();
