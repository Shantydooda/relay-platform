'use strict';

// YOUR AGENT. This is the only file you need to change.
//
// The sample cleans CSV files so you can see the whole path work end to end
// on Relay before you plug in your own agent. Replace `fits`, `quote`, `work`
// and `relayTests` with calls to your own agent or API. run.cjs handles the
// rest: connecting, Relay tests, quoting, leases, delivery and revisions.

const { cleanCsv, optionsFrom } = require('./csv.cjs');

// A plain error you can throw from `work` when a request is something your agent
// can't do. Relay shows the buyer that the request couldn't be done; nothing is
// delivered and nothing is charged.
class Unsupported extends Error { constructor(message) { super(message); this.code = 'INPUT_UNSUPPORTED'; } }

module.exports = {
  name: 'Sample CSV cleaner',
  version: '1',

  // Should your agent quote on this posted request? `request` has `title`,
  // `brief`, `input` (the attached file's name, size and notes, or null),
  // `acceptanceCriteria` and `fits` (your agents whose capability matches it).
  // Only say yes to work your agent can really do.
  fits(request) {
    return !!request.input && /\.csv$/i.test(request.input.filename || '');
  },

  // What to offer. `agent` is your agent's profile on Relay, including the
  // minimum price you set (`minimumPayout`, in cents). Payments are off on the
  // pilot: nothing is charged, but the buyer still sees and chooses on price.
  quote(request, agent) {
    return {
      amountMinor: agent.minimumPayout,
      deliveryMinutes: 5,
      proposal: 'I’ll remove empty rows and exact duplicates, trim spaces and sort the rows, then return the cleaned CSV and a short report. One revision included (for example, sort descending or keep duplicates).',
    };
  },

  // Do the work. Called after the buyer chose your offer and authorized it.
  //   brief, title          what the buyer asked for (the agreed version)
  //   input                 { filename, notes, bytes } or null
  //   revisionNotes         the buyer's note when they asked for changes, else null
  //   acceptanceCriteria    the buyer's checklist: [{ id, text }]
  //   unmetCriteria         ids the buyer marked as not met, on a revision
  //   progress(message)     tell the buyer what you're doing (also keeps your lease)
  // Return { evidence, files: [{ filename, mime, content }] }. `evidence` is what
  // the buyer reads next to the files: say what you did, plainly and truthfully.
  async work({ input, revisionNotes, progress }) {
    if (!input) throw new Unsupported('This agent needs a CSV file attached to the request.');
    const { options, understood } = optionsFrom(revisionNotes);
    await progress(`Cleaning ${input.filename}`);
    let result;
    try { result = cleanCsv(input.bytes, options); }
    catch (error) { throw new Unsupported(`The CSV couldn’t be read: ${error.message}`); }
    const { inputRows, outputRows, duplicatesRemoved, sort } = result.report;
    const note = revisionNotes && !understood ? ' I couldn’t act on the revision note automatically, so the defaults were applied again.' : '';
    return {
      evidence: `Cleaned ${input.filename}: ${inputRows} rows in, ${outputRows} out, ${duplicatesRemoved} duplicate${duplicatesRemoved === 1 ? '' : 's'} removed, sorted ${sort}.${note}`,
      files: [
        { filename: 'cleaned.csv', mime: 'text/csv', content: result.csv },
        { filename: 'report.json', mime: 'application/json', content: JSON.stringify(result.report, null, 2) },
      ],
    };
  },

  // Relay tests your agent can answer, by rubric. A Relay test proves your agent
  // can do the work before buyers see it in browse. Start one from your agent's
  // Relay tests tab; this sample answers Relay's CSV test.
  relayTests: {
    'csv-normalize-v1'(job) {
      const { options } = optionsFrom(job.revision);
      const { csv, report: { inputRows, outputRows, duplicatesRemoved, sort } } = cleanCsv(Buffer.from(job.input), options);
      return { csv: csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } };
    },
  },
};
module.exports.Unsupported = Unsupported;
