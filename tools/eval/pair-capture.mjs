// Thin re-export of the capture hook that lives inside the coach plugin.
//
// The implementation must sit in dsh-coach-server/lib so it travels with the plugin bundle;
// this file exists so eval tooling and tests have a stable path.

export { savePair, maybeSavePair, captureFacts, evalCaptureEnabled } from '../dsh-coach-server/lib/eval-capture.js';
