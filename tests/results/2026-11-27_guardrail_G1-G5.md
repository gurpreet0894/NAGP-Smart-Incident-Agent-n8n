| # | Scenario | Final status | Attempts | Evidence | Result |
|---|---|---|---|---|---|
| G1 | Bad team name on the first attempt only: recovers on retry 1 | routed | 2 | The assistant needed 1 retry to pass the automatic checks. / 3 sensitive item(s) were masked before analysis (EMAIL x1, CARD/NUMBER x1, PHONE x1). | PASS |
| G2 | Invented incident ID twice: recovers on retry 2 (last allowed attempt) | routed | 3 | The assistant needed 2 retries to pass the automatic checks. | PASS |
| G3 | Permanently bad team name: 2 retries, then MANUAL ROUTING NEEDED | manual_routing_required | 3 | primary_team "Payments" is not an exact team name in the Team Directory. Valid names: "Payments Backend", "Catalog & Search", "Orders & Fulfilment", "Accounts & | PASS |
| G4 | Passive 'just monitor' action on a HIGH-severity incident: rejected, then recovers | routed | 2 | The assistant needed 1 retry to pass the automatic checks. | PASS |
| G5 | Tone does not fit a prolonged incident: decision validation raises a warning | routed_with_warnings | 1 | Urgency is "prolonged" but tone is "calm_informational" (expected one of: apologetic_urgent). / Second-opinion review: The escalation is appropriate for medium  | PASS |
