var OAuth = require('oauth-1.0a');

let CryptoJS = require("crypto-js");
let fetch = require("node-fetch")
import {CMMC_Storage as Storage} from './Storage'
import * as Helper from './Util'
let Util = Helper.Util

const VERSION = '1.0.9';
const GEARAPIADDRESS = 'ga.netpie.io';
const GEARAPIPORT = '8080';


const MGREV = 'NJS1a';

const gearauthurl = 'http://' + GEARAPIADDRESS + ':' + GEARAPIPORT;
let verifier = MGREV;

export class NetpieAuth {
  constructor (props) {
    this.appid = props.appid
    this.appkey = props.appkey
    this.appsecret = props.appsecret
    this.create(props)
    this._storage = new Storage(this.appid)
  }


  getMqttAuth = async (callback) => {
    Util.log(`getMqttAuth: `, "STATE = ", this._storage.get(Storage.KEY_STATE));
    if (this._storage.get(Storage.KEY_STATE) == Storage.STATE.STATE_ACCESS_TOKEN) {
      Util.log(`STATE = ACCESS_TOKEN, RETRVING LAST VALUES...`)
      let [appkey, appsecret, appid] = [this.appkey, this.appsecret, this.appid]
      let [access_token, access_token_secret] = [this._storage.get(Storage.KEY_ACCESS_TOKEN),
        this._storage.get(Storage.KEY_ACCESS_TOKEN_SECRET)]

      let endpoint = decodeURIComponent(this._storage.get(Storage.KEY_ENDPOINT))
      let hkey = Util.compute_hkey(access_token_secret, appsecret)
      let mqttusername = `${appkey}%${Math.floor(Date.now() / 1000)}`;
      let mqttpassword = Util.compute_mqtt_password(access_token, mqttusername, hkey)
      let revoke_code = Util.compute_revoke_code(access_token, hkey)
      let [input, protocol, host, port] = endpoint.match(/^([a-z]+):\/\/([^:\/]+):(\d+)/)
      let matched = endpoint.match(/^([a-z]+):\/\/([^:\/]+):(\d+)/)
      let ret = {
        username: mqttusername,
        password: mqttpassword,
        client_id: access_token,
        prefix: `/${appid}/gearname`,
        appid: appid,
        host: host,
        port: port,
        endpoint: endpoint
      }
      callback.apply(this, [ret]);
    }
    else {
      try {
        await this.getToken();
        return this.getMqttAuth(callback);
      }
      catch (err) {
        Util.log("ERROR: getMqttAuth", err)
        return null;
      }
    }
  }

  create (config) {
    this.oauth = OAuth({
      consumer: {
        key: config.appkey,
        secret: config.appsecret
      },
      last_ampersand: true,
      signature_method: 'HMAC-SHA1',
      hash_function: function (base_string, key) {
        return CryptoJS.HmacSHA1(base_string, key).toString(CryptoJS.enc.Base64);
      }
    });
  }

  extract (response) {
    let arr = response.split('&');
    let reduced = arr.reduce((acc, v) => {
      let [key, value] = v.split("=");
      acc[key] = value;
      return acc;
    }, {});
    return reduced;
  }

  async request (data, auth_func) {
    let ret = fetch(data.url, {
      method: data.method,
      timeout: 5000,
      headers: {
        'Authorization': auth_func.apply(this, [data]),
      }
    });
    return ret;
  }

  build_request_object (uri, method = 'POST') {
    let obj = {
      method: method,
      url: gearauthurl + uri,
    };

    let ret = {
      object: () => obj,
      data: (val) => {
        obj.data = val
        return ret;
      },
      request: (auth_func) => {
        return this.request(ret.object(), auth_func)
      }
    }
    return ret;
  }

  _getRequestToken = async () => {
    return await this.build_request_object('/api/rtoken')
    .data({oauth_callback: 'scope=&appid=' + "" + this.appid + '&mgrev=' + MGREV + '&verifier=' + verifier})
    .request((request_token) => {
      return this.oauth.toHeader(this.oauth.authorize(request_token)).Authorization
    });
  }

  _getAccessToken = async () => {
    return await this.build_request_object('/api/atoken')
    .data({oauth_verifier: verifier})
    .request((request_data) => {
      let _reqtok = {
        key: this._storage.get(Storage.KEY_OAUTH_REQUEST_TOKEN),
        secret: this._storage.get(Storage.KEY_OAUTH_REQUEST_TOKEN_SECRET)
      };
      let auth_header = this.oauth.toHeader(this.oauth.authorize(request_data, _reqtok)).Authorization
      return auth_header;
    })
  }

  _saveRequestToken = (object) => {
    Util.log(`SET STATE= ${Storage.STATE.STATE_REQ_TOKEN}`)
    let _data = new Map();

    _data.set(Storage.KEY_STATE, Storage.STATE.STATE_REQ_TOKEN);
    _data.set(Storage.KEY_OAUTH_REQUEST_TOKEN, object.oauth_token);
    _data.set(Storage.KEY_OAUTH_REQUEST_TOKEN_SECRET, object.oauth_token_secret);
    _data.set(Storage.KEY_VERIFIER, object.verifier)

    for (let [key, value] of _data.entries()) {
      Util.log("SAVE REQ TOKEN: KEY ", key, ">>", value)
      this._storage.set(key, value)
    }
  }

  _saveAccessToken = (object) => {
    Util.log(`SET STATE= ${Storage.STATE.STATE_ACCESS_TOKEN}`)
    let _data = new Map();
    _data.set(Storage.KEY_STATE, Storage.STATE.STATE_ACCESS_TOKEN);
    _data.set(Storage.KEY_ACCESS_TOKEN, object.oauth_token);
    _data.set(Storage.KEY_ACCESS_TOKEN_SECRET, object.oauth_token_secret);
    _data.set(Storage.KEY_ENDPOINT, object.endpoint);
    _data.set(Storage.KEY_FLAG, object.flag);

    for (let [key, value] of _data.entries()) {
      Util.log("SAVE ACCESS TOKEN: KEY ", key, ">>", value)
      this._storage.set(key, value)
    }
    Util.log("DONE save ACCESS TOKEN then commit...");
    this._storage.commit()
  }


  getToken = async () => {
    try {
      Util.log(`NetpieAuth.js ${this}`)
      // @flow STEP1: GET REQUEST TOKEN
      let req1_resp = await this._getRequestToken();
      let {oauth_token, oauth_token_secret} = this.extract(await req1_resp.text());
      this._saveRequestToken({oauth_token, oauth_token_secret, verifier})

      // @flow STEP2: GET ACCESS TOKEN
      let req2_resp = await this._getAccessToken();
      let token = this.extract(await req2_resp.text())
      this._saveAccessToken({
        oauth_token: token.oauth_token,
        oauth_token_secret: token.oauth_token_secret,
        endpoint: token.endpoint,
        flag: token.flag
      })

      return token
    }
    catch (ex) {
      Util.log("ERROR", ex);
      return null
    }
  };
}
