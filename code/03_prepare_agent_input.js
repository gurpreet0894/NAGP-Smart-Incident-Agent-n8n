// Code node: "Prepare Agent Input"  (mode: Run Once for All Items)
// The two Google Sheets nodes return one item per row. This node collapses back to ONE item
// that carries the incident state through the agent / retry loop.

const incident = $('Enrich Context').first().json;

return [
  {
    json: {
      ...incident,
      retry_count: 0,
      retry_feedback: '',
    },
  },
];
