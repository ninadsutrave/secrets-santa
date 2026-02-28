const path = require("path");

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";
  return {
    mode: isProd ? "production" : "development",
    entry: path.resolve(__dirname, "src/popup/modules/index.js"),
    output: {
      filename: "popup.bundle.js",
      path: path.resolve(__dirname, "dist"),
      clean: true
    },
    devtool: isProd ? false : "source-map",
    target: "web",
    module: {
      rules: []
    },
    optimization: {
      minimize: isProd
    }
  };
};
