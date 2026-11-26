// Code node: "Build Retry Input"  (mode: Run Once for All Items)
// Runs only when a check failed AND retries remain. Sends the failure reasons back to the agent.

const c = $input.first().json;
const retry_count = c.attempt + 1;

const previous = c.agent_output
  ? JSON.stringify({
      primary_team: c.agent_output.primary_team,
      matched_incident_id: c.agent_output.matched_incident_id,
      first_action: c.agent_output.first_action,
    })
  : '(no valid answer)';

const retry_feedback =
  `RETRY ${retry_count} of ${c.max_retries}. Your previous answer was rejected by the automatic checks.\n` +
  `Previous answer: ${previous}\n` +
  `Reasons:\n${c.failures.map((f, i) => `${i + 1}. ${f}`).join('\n')}\n` +
  `Fix every reason above, use your tools again if needed, and answer in the required format.`;

// Carry only the original incident state forward (not the previous agent output)
const {
  agent_output, tools_called, history_tool_called, directory_tool_called, directory_row,
  matched_incident_row, checks_passed, failures, attempt, max_retries,
  ...incident
} = c;

return [{ json: { ...incident, retry_count, retry_feedback } }];
