import * as core from '@actions/core';
import * as fs from 'fs';

const DEFAULT_BASE_URL = 'https://api.quantcdn.io/v1';

async function run(): Promise<void> {
  try {
    const apiKey = core.getInput('quant_api_key', { required: true });
    const organization = core.getInput('quant_organization', { required: true });
    const agentId = core.getInput('agent_id', { required: true });
    const testFixturesPath = core.getInput('test_fixtures');
    const userMessage = core.getInput('user_message') || 'Begin assessment.';
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

    // Dispatch agent in async + test mode
    core.info(`Dispatching agent ${agentId} in test mode...`);

    const dispatchUrl = `${baseUrl}/inference/chat`;
    const dispatchBody = {
      agentId,
      orgId: organization,
      messages: [{ role: 'user', content: userMessage }],
      async: true,
      testMode: true,
      toolFixtures,
    };

    const dispatchResponse = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Quant-Organization': organization,
      },
      body: JSON.stringify(dispatchBody),
    });

    if (dispatchResponse.status !== 202) {
      const errorBody = await dispatchResponse.text();
      core.setFailed(`Agent dispatch failed (${dispatchResponse.status}): ${errorBody}`);
      return;
    }

    const dispatchResult = await dispatchResponse.json() as {
      requestId: string;
      pollUrl: string;
    };

    core.info(`Agent dispatched. Execution ID: ${dispatchResult.requestId}`);
    core.info(`Polling for completion (timeout: ${timeout}s)...`);

    // Poll for completion
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds
    let completed = false;
    let finalResult: any = null;

    while (Date.now() - startTime < timeout * 1000) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));

      const pollUrl = dispatchResult.pollUrl || `${baseUrl}/inference/chat/executions/${dispatchResult.requestId}`;
      const pollResponse = await fetch(pollUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'X-Quant-Organization': organization,
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

      if (pollResult.status === 'completed') {
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

    // Extract outputs
    const agentOutput = finalResult.result || {};
    const conversationContext = {
      tool_calls: finalResult.toolCalls || [],
    };

    core.setOutput('agent_output', JSON.stringify(agentOutput));
    core.setOutput('conversation_context', JSON.stringify(conversationContext));
    core.setOutput('execution_id', dispatchResult.requestId);

    core.info(`Agent completed successfully. Output available in step outputs.`);
  } catch (error) {
    core.setFailed(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

run();
