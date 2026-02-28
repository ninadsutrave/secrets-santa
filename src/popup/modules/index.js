// Aggregate entry for production bundling (webpack).
// Import order matters to ensure globals are initialized correctly.
import "../../shared/constants.js";
import "../../shared/storage.js";
import "./env-utils.js";
import "./modals.js";
import "./table.js";
import "./token.js";
import "./collections.js";
import "./compare.js";
import "./upload.js";
import "../popup.js";
