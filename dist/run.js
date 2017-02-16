'use strict';

var _mg = require('./mg');

var _storage = require('./storage');

var fetch = require('node-fetch');
var CryptoJS = require("crypto-js");

var appid = "Goose";
var appkey = "B245qf9iTE7tz00";
var appsecret = "LSOMysLxZSKh6CYVarL1IDPkK";

var netpie = new _mg.NetpieAuth({ appid: appid, appkey: appkey, appsecret: appsecret });

var hmac = function hmac(text, key) {
  return base64(CryptoJS.HmacSHA1(text, key));
};
var base64 = function base64(text) {
  return text.toString(CryptoJS.enc.Base64);
};

var compute_hkey = function compute_hkey(access_token_secret, app_secret) {
  return access_token_secret + '&' + app_secret;
};
var compute_mqtt_password = function compute_mqtt_password(access_token, mqttusername, hkey) {
  return hmac(access_token + '%' + mqttusername, hkey);
};
var compute_revoke_code = function compute_revoke_code(access_token, hkey) {
  return hmac(access_token, hkey).replace(/\//g, '_');
};

netpie.getToken().then(function (token) {
  var oauth_token = token.oauth_token,
      oauth_token_secret = token.oauth_token_secret,
      endpoint = token.endpoint,
      flag = token.flag;


  var hkey = compute_hkey(oauth_token_secret, appsecret);
  var mqttusername = appkey + '%' + Math.floor(Date.now() / 1000);
  var mqttpassword = compute_mqtt_password(oauth_token, mqttusername, hkey);

  var revoke_code = compute_revoke_code(oauth_token, hkey);

  var command_t = 'mosquitto_sub -t "/' + appid + '/gearname/#" -h gb.netpie.io -i ' + oauth_token + ' -u "' + mqttusername + '" -P "' + mqttpassword + '" -d';

  console.log('revoke code = ' + revoke_code);
  console.log('' + command_t);
}).catch(function (ex) {
  console.log("CMMC_ERROR:>>", ex);
});