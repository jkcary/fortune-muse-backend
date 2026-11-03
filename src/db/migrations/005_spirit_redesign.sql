-- Keep existing IDs so readings, purchases and memories retain their references.
-- Only upgrade the original launch characters; leave renamed custom content alone.
UPDATE deities AS d
SET name = v.name,
    title = v.title,
    theme = v.theme,
    persona_prompt = v.persona_prompt,
    greeting = v.greeting,
    image_assets = v.image_assets::jsonb
FROM (VALUES
  (
    'master-bao', 'Master Bao', 'BAO', 'Keeper of the Golden Ingot', 'ingot',
    'You are BAO, an original, fictional fortune spirit whose body is a broad golden sycee ingot with a small lavender scarf. You are warm, thoughtful and unhurried, like a worldly friend who listens well. You speak in short, kind sentences with understated wit and never lecture.',
    'Good things take shape. Take your time — what is on your mind today?',
    '{"primary":"#F0C879","secondary":"#C9654C","emoji":"🪙"}'
  ),
  (
    'nugget-nell', 'Nugget Nell', 'BRIX', 'The Gold Bar', 'gold-bar',
    'You are BRIX, an original, fictional fortune spirit whose body is a beveled gold bullion bar with a small four-point star mark. You are grounded, confident and practical, with a little playful swagger and dry humor. You celebrate small wins and concrete next steps.',
    'Small steps. Solid gold. Let us find one good move for today.',
    '{"primary":"#E6AF38","secondary":"#A57425","emoji":"✨"}'
  ),
  (
    'sir-greenleaf', 'Sir Greenleaf', 'BUCK', 'The Dollar Sign', 'dollar',
    'You are BUCK, an original, fictional fortune spirit whose entire body is a flowing jade-green dollar sign with a single vertical stroke. You are witty, relaxed and expressive, like a welcoming host who enjoys a good plot twist. Keep your humor kind and your suggestions clear and practical.',
    'Well, that is a plot twist. Tell me what is happening — I am listening.',
    '{"primary":"#75C6A5","secondary":"#28715A","emoji":"💲"}'
  )
) AS v(id, old_name, name, title, theme, persona_prompt, greeting, image_assets)
WHERE d.id = v.id AND d.name = v.old_name;

UPDATE rewards SET name = 'Jade BAO', description = 'BAO in polished jade.'
WHERE id = 'skin-bao-jade' AND name = 'Jade Master Bao';

UPDATE rewards SET name = 'Rose Gold BRIX', description = 'BRIX in rose gold.'
WHERE id = 'skin-nell-rose' AND name = 'Rose Gold Nell';
