'use strict';

const { fail, text, exactKeys } = require('./input.cjs');
const nullable = type => ({ type: [type, 'null'], minLength: 1, maxLength: 300 });
const fields = {
  intent: { type: 'string', description: 'The buyer intent: request includes incomplete new work; question is only an actual question from the buyer.', enum: ['request', 'change', 'question', 'hypothetical'] },
  cadence: { type: 'string', description: 'Use once unless repeated runs were explicitly requested. A missing deadline does not make cadence unclear.', enum: ['once', 'daily', 'weekly', 'monthly', 'unclear'] },
  questions: { type: 'array', description: 'Essential missing information to ask the buyer before the work can be scoped. Do not silently fill gaps.', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 3 },
  assumptions: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 500 }, maxItems: 8 },
  title: { type: 'string', minLength: 1, maxLength: 120 },
  brief: { type: 'string', minLength: 1, maxLength: 10000 },
  schedule: nullable('string'), timezone: nullable('string'),
  perRunBudget: nullable('string'), monthlyCap: nullable('string'),
  reply: { type: 'string', minLength: 1, maxLength: 2000 }
};
const schema = { type: 'object', additionalProperties: false, required: Object.keys(fields), properties: fields };

function validateProposal(value) {
  try {
    exactKeys(value, Object.keys(fields));
    const result = {
      reply: text(value.reply, 'Reply', 1, 2000),
      title: text(value.title, 'Title', 1, 120),
      brief: text(value.brief, 'Brief', 1, 10000)
    };
    for (const [key, max] of [['questions', 3], ['assumptions', 8]]) {
      if (!Array.isArray(value[key]) || value[key].length > max) throw new Error('Invalid list');
      result[key] = value[key].map(item => text(item, key, 1, 500));
    }
    if (!fields.intent.enum.includes(value.intent) || !fields.cadence.enum.includes(value.cadence)) throw new Error('Invalid enum');
    result.intent = value.intent; result.cadence = value.cadence;
    for (const key of ['schedule', 'timezone', 'perRunBudget', 'monthlyCap']) {
      result[key] = value[key] === null ? null : text(value[key], key, 1, 300);
    }
    if (result.timezone) {
      try { new Intl.DateTimeFormat('en', { timeZone: result.timezone }); }
      catch { throw new Error('Invalid timezone'); }
    }
    return result;
  } catch { fail(502, 'INVALID_MODEL_OUTPUT', 'The local model returned an invalid suggestion. Your brief is unchanged.'); }
}

module.exports = { schema, validateProposal };
