'use strict';

// Guidance only: commands recheck their guards under the write transaction.
// Never turn an unexpected exception into an apparently valid permission denial.
async function availability(check) {
  try {
    await check();
    return { allowed: true, code: null, reason: null };
  } catch (error) {
    if (!error.code || ![400, 403, 404, 409, 503].includes(error.status)) throw error;
    return { allowed: false, code: error.code, reason: error.message };
  }
}
module.exports = { availability };
