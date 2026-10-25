/**
 * The prompt a person pastes into a Claude / ChatGPT scheduled task so an agent writes their Morning Brief through the
 * connector (day.morning_brief.write, migration 274). Client-safe. A test checks that every read entity named here exists
 * in the registry and that the write op is registered, so a rename cannot leave the prompt pointing at nothing.
 */
export const MORNING_BRIEF_SCHEDULE_PROMPT = `Write my Life OS Morning Brief for today and save it with my Life OS connector.

1. Call list_capabilities once if you are unsure what you can read.
2. Read what matters for today with the read tool. Useful sources: my open tasks (\`work.task\`, \`school.task\`), tonight's plan (\`review.night_plan_task\`), classes and calendar items (\`school.schedule_event\`, \`school.class_assessment\`), today's prayers and habits (\`deen.prayer\`, \`deen.habit\`), and today's workouts (\`fitness.workout_session\`). Skip anything that is empty or not enabled for me.
3. Write the brief: 2 to 4 short paragraphs of plain text, warm and specific. Lead with the one or two things that matter most today, then what is coming up and when, then one line of encouragement. Never invent tasks or times you did not read.
4. Write every time in 12-hour form with AM or PM, like 9:00 PM. Never 24-hour times.
5. Save it with the write tool: domain "day", entity "morning_brief", action "write", patch { "text": "<the brief>" }. Plain text only (no HTML or markdown tables), at most 2000 characters. Leave out the date so it saves for my local today. Saving again replaces the brief.

If the connector is not available or a call fails, stop and tell me what failed instead of retrying in a loop.`;
