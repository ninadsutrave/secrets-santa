// Aggregate entry for production bundling (esbuild).
// Import order matters to ensure globals are initialized correctly.
import "../../shared/constants";
import "../../shared/storage";
import "./env-utils";
import "./modals";
import "./table";
import "./token";
import "./collections";
import "./compare";
import "./upload";
import "../popup";
