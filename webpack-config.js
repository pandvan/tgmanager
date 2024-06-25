
module.exports = {

  entry: {
    "webui": "./webUI/js/webui.js"
  },
  mode: "development",
  devtool: 'eval',
  watch: false,

  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      },
      {
        test: /\.pug$/,
        use: ['pug-loader']
      }
    ]
  },
  resolve: {
    alias: {
    }
  },
  output: {
    path: `${__dirname}/public`,
    filename: "[name].dev.js",
    pathinfo: true,
    sourceMapFilename: "[file].js.map"
  }
};
