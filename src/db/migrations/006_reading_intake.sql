-- The conversation with the deity before a reading: { turns: [{role, text}], summary: {question, context, timeframe, goal} }.
ALTER TABLE readings ADD COLUMN intake_json jsonb;
