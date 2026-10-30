# Quant Agent Dispatch Action

A GitHub Action for dispatching AI agent runs in test mode on the Quant platform. Sends a user message to an agent with optional tool fixtures, waits for completion, and returns the agent output and conversation context.

## Features

- **Test Mode Execution**: Dispatches agents in async test mode with deterministic tool fixture responses
- **Fixture Support**: Load tool fixture responses from a JSON file for reproducible agent runs
- **Automatic Polling**: Waits for agent completion with configurable timeout
- **Conversation Capture**: Returns full conversation context including tool calls for downstream validation

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `quant_api_key` | Yes | Quant API key |
| `quant_organization` | Yes | Quant organisation name |
| `agent_id` | Yes | Agent UUID to dispatch |
| `test_fixtures` | No | Path to JSON file with tool fixture responses |
| `user_message` | No | Initial user message to send to the agent (default: `Begin assessment.`) |
| `timeout` | No | Max wait time in seconds for agent completion (default: `300`) |
| `base_url` | No | Quant AI API base URL |

## Outputs

| Output | Description |
|--------|-------------|
| `agent_output` | JSON string of the agent final tool call output |
| `conversation_context` | JSON string of conversation context (tool calls made) |
| `execution_id` | The execution ID for the agent run |

## Usage

### Basic Usage

```yaml
- name: Dispatch Agent
  uses: quantcdn/quant-cloud-agent-dispatch-action@v1
  id: dispatch
  with:
    quant_api_key: ${{ secrets.QUANT_API_KEY }}
    quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
    agent_id: ${{ vars.AGENT_ID }}
```

### With Tool Fixtures

```yaml
- name: Dispatch Agent with Fixtures
  uses: quantcdn/quant-cloud-agent-dispatch-action@v1
  id: dispatch
  with:
    quant_api_key: ${{ secrets.QUANT_API_KEY }}
    quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
    agent_id: ${{ vars.AGENT_ID }}
    test_fixtures: agents/my-agent/fixtures.json
    user_message: 'Assess the current state of the website.'
    timeout: '600'
```

### Complete Pipeline Example

```yaml
name: Agent Validation Pipeline
on:
  push:
    branches: [main]
    paths: ['agents/**']

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy Agent Specs
        uses: quantcdn/quant-cloud-agent-deploy-action@v1
        with:
          quant_api_key: ${{ secrets.QUANT_API_KEY }}
          quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
          agents_dir: agents/

      - name: Dispatch Agent
        uses: quantcdn/quant-cloud-agent-dispatch-action@v1
        id: dispatch
        with:
          quant_api_key: ${{ secrets.QUANT_API_KEY }}
          quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
          agent_id: ${{ vars.AGENT_ID }}
          test_fixtures: agents/my-agent/fixtures.json

      - name: Validate Agent Output
        uses: quantcdn/quant-cloud-agent-validate-action@v1
        with:
          quant_api_key: ${{ secrets.QUANT_API_KEY }}
          quant_organization: ${{ secrets.QUANT_ORGANIZATION }}
          agent_id: ${{ vars.AGENT_ID }}
          agent_output: ${{ steps.dispatch.outputs.agent_output }}
          conversation_context: ${{ steps.dispatch.outputs.conversation_context }}
          test_fixtures: agents/my-agent/fixtures.json
```

## Error Handling

The action will fail if:
- The API key or organization is invalid
- The agent ID does not exist
- The agent execution times out
- The API returns an unexpected error

## Development

### Building

```bash
npm install
npm run build
```

### Testing

```bash
npm test
```

## License

This project is licensed under the MIT License.

## Runner security requirement

This action uses the runner's embedded Node 24, which must be 24.22.1 or later
for CVE-2026-111497. Update self-hosted runner containers/binaries to apply the
fix. A `setup-node` workflow step changes the job shell runtime, not the Node
binary GitHub uses to execute actions. A pre-run check rejects vulnerable
runner versions before action API calls. Use the current maintained action tag
or its immutable release SHA; historical pinned releases do not update themselves.
