/* global atob, Buffer, TextDecoder, BUILD_VERSION */

import 'bootstrap';
import CodeMirror from 'codemirror/lib/codemirror.js';
import $ from "jquery";
import jose from "node-jose";
import LocalStorage from './LocalStorage.js';

const html5AppId = '2084664E-BF2B-4C76-BD5F-1087502F580B';

const storage = LocalStorage.init(html5AppId);
let datamodel = {
      'sel-variant': '',
      'sel-enc': '',
      'encodedjwt' : '',
      'ta_publickey' : '',
      'ta_privatekey' : '',
      'ta_symmetrickey' : '',
      'sel-expiry': 10,
      'sel-symkey-coding' : '',
      'chk-iat': true
    };

require('codemirror/mode/javascript/javascript');
require('codemirror/addon/mode/simple');

const tenMinutesInSeconds = 10 * 60;
const ITERATION_DEFAULT = 8192,
      ITERATION_MAX = 100001,
      ITERATION_MIN = 50;
const re = {
        signed : {
          jwt : new RegExp('^([^\\.]+)\\.([^\\.]+)\\.([^\\.]+)$'),
          cm : new RegExp('^([^\\.]+)(\\.)([^\\.]+)(\\.)([^\\.]+)$')
        },
        encrypted: {
          jwt : new RegExp('^([^\\.]+)\\.([^\\.]*)\\.([^\\.]+)\\.([^\\.]+)\\.([^\\.]+)$'),
          cm :  new RegExp('^([^\\.]+)(\\.)([^\\.]*)(\\.)([^\\.]+)(\\.)([^\\.]+)(\\.)([^\\.]+)$')
        }
      };
const sampledata = {
        names : ['audrey', 'olaf', 'antonio', 'alma', 'ming', 'naimish', 'anna', 'sheniqua', 'tamara', 'kina', 'maxine', 'arya', 'asa', 'idris', 'evander', 'natalia' ],
        props : ['propX', 'propY', 'aaa', 'version', 'entitlement', 'alpha', 'classid'],
        types : ['number', 'string', 'object', 'array', 'boolean']
      };

function algPermutations(prefixes) {
  return prefixes.reduce( (a, v) =>
    [...a, ...[256,384,512].map(x=>v+x)], []);
}

const rsaSigningAlgs = algPermutations(['RS','PS']),
      ecdsaSigningAlgs = algPermutations(['ES']),
      hmacSigningAlgs = algPermutations(['HS']),
      signingAlgs = [...rsaSigningAlgs, ...ecdsaSigningAlgs, ...hmacSigningAlgs],
      rsaKeyEncryptionAlgs = ['RSA-OAEP','RSA-OAEP-256'],
      ecdhKeyEncryptionAlgs = ['ECDH-ES', 'ECDH-ES+A128KW', 'ECDH-ES+A256KW'], // 'ECDH-ES+A192KW' not supported
      pbes2KeyEncryptionAlgs = ['PBES2-HS256+A128KW', 'PBES2-HS384+A192KW', 'PBES2-HS512+A256KW'],
      keyEncryptionAlgs = [...rsaKeyEncryptionAlgs, ...pbes2KeyEncryptionAlgs, ...ecdhKeyEncryptionAlgs],
      contentEncryptionAlgs = [
        'A128CBC-HS256',
        'A256CBC-HS512',
        'A128GCM',
        'A256GCM'
      ],
      pwComponents = [
        ['Vaguely', 'Undoubtedly', 'Indisputably', 'Understandably', 'Definitely', 'Possibly'],
        ['Salty', 'Fresh', 'Ursine', 'Excessive', 'Daring', 'Delightful', 'Stable', 'Evolving'],
        ['Mirror', 'Caliper', 'Postage', 'Return', 'Roadway', 'Passage', 'Statement', 'Toolbox', 'Paradox', 'Orbit', 'Bridge']
      ];

let editors = {}; // codemirror editors

CodeMirror.defineSimpleMode("encodedjwt", {
  start : [
    {
      regex: re.signed.cm,
      sol: true,
      token: ["jwt-header", "", "jwt-payload", "", "jwt-signature"]
    },
    {
      regex: re.encrypted.cm,
      sol: true,
      token: ["jwt-header", "", "jwt-key", "", "jwt-iv", "", "jwt-payload", "", "jwt-authtag"]
    }
  ]
});

const quantify = (quantity, term) => {
        let termIsPlural = term.endsWith('s'),
            quantityIsPlural = (quantity != 1 && quantity != -1);

        if (termIsPlural && !quantityIsPlural)
          return term.slice(0, -1);

        return ( ! termIsPlural && quantityIsPlural) ?  term + 's': term;
      };

function reformIndents(s) {
  let s2 = s.split(new RegExp('\n', 'g'))
    .map(s => s.trim())
    .join("\n");
  return s2.trim();
}

const randomString = () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

const randomBoolean = () => Math.floor(Math.random() * 2) == 1;

const randomNumber = () => {
        let min = (randomBoolean())? 10: 100,
            max = (randomBoolean())? 100000: 1000;
        return Math.floor(Math.random() * (max - min)) + min;
      };

function randomArray() {
  let n = Math.floor(Math.random() * 4) + 1, // at least 1 element
      a = [], type;
  for(var i = 0; i < n; i++){
    type = selectRandomValueExcept(sampledata.types, ['array', 'object']);
    a[i] = generateRandomValue(type);
  }
  return a;
}

function randomObject(depth, exclusion) {
  let n = Math.floor(Math.random() * 4) + 1,
      obj = {}, propname, type;
  for(var i = 0; i < n; i++) {
    propname = selectRandomValueExcept(sampledata.props, exclusion);
    // limit complexity
    type = (depth >1) ?
      selectRandomValueExcept(sampledata.types, ['array', 'object']) :
      selectRandomValue(sampledata.types);
    obj[propname] = generateRandomValue(type, depth, propname);
  }
  return obj;
}

function generateRandomValue (type, depth, parentName) {
  type = type || selectRandomValue(sampledata.types);
  depth = (typeof depth == 'number')? depth + 1 : 1;
  switch(type) {
  case 'number' :
    return randomNumber();
  case 'string' :
    return randomString();
  case 'array' :
    return randomArray();
  case 'object' :
    return randomObject(depth, parentName);
  case 'boolean' :
    return randomBoolean();
  }
  return null;
}

function selectRandomValueExcept (a, exclusion) {
  let v = null;
  if ( ! exclusion) { exclusion = []; }
  if ( ! Array.isArray(exclusion)) {
    exclusion = [exclusion];
  }
  do {
    v = selectRandomValue (a);
  } while(exclusion.indexOf(v) >= 0);
  return v;
}

function selectRandomValue (a) {
  let L = a.length,
      n = Math.floor(Math.random() * L);
  return a[n];
}

function randomOctetKey() {
  var array = new Uint8Array(48);
  window.crypto.getRandomValues(array);
  return array;
}

function randomPassword() {
  return pwComponents
    .map(selectRandomValue)
    .join('-') +
    '-' +
    randomNumber().toFixed(0).padStart(4, '0').substr(-4) +
    '-' +
    randomNumber().toFixed(0).padStart(7, '0').substr(-7);
}

function hmacToKeyBits(alg) {
  switch(alg) {
  case 'HS256' : return 256;
  case 'HS384' : return 384;
  case 'HS512' : return 512;
  }
  return 9999999;
}

function algToKeyBits(alg) {
  if (alg.startsWith('PBES2')) {
    let hmac = alg.substring(6, 11);
    return hmacToKeyBits(hmac);
  }
  return hmacToKeyBits(alg);
}

function getPbkdf2IterationCount() {
  let icountvalue = $('#ta_pbkdf2_iterations').val(),
      icount = ITERATION_DEFAULT;
  try {
    icount = Number.parseInt(icountvalue, 10);
  }
  catch (exc1) {
    setAlert("not a number? defaulting to iteration count: "+ icount);
  }
  if (icount > ITERATION_MAX || icount < ITERATION_MIN) {
    icount = ITERATION_DEFAULT;
    setAlert("iteration count out of range. defaulting to: "+ icount);
  }
  return icount;
}

function getPbkdf2SaltBuffer() {
  let keyvalue = $('#ta_pbkdf2_salt').val();
  let coding = $('.sel-symkey-pbkdf2-salt-coding').find(':selected').text().toLowerCase();
  let knownCodecs = ['utf-8', 'base64', 'hex'];

  if (knownCodecs.indexOf(coding)>=0) {
    return Buffer.from(keyvalue, coding);
  }
  throw new Error('unsupported salt encoding'); // will not happen
}

async function getSymmetricKeyBuffer(alg) {
  let keyvalue = $('#ta_symmetrickey').val();
  let coding = $('.sel-symkey-coding').find(':selected').text().toLowerCase();
  let knownCodecs = ['utf-8', 'base64', 'hex'];

  if (knownCodecs.indexOf(coding)>=0) {
    return Promise.resolve(Buffer.from(keyvalue, coding));
  }

  if (coding == 'pbkdf2') {
    let kdfParams = {
          salt: getPbkdf2SaltBuffer(),
          iterations: getPbkdf2IterationCount(),
          length: algToKeyBits(alg) / 8
        };
    return jose.JWA.derive("PBKDF2-SHA-256", Buffer.from(keyvalue, 'utf-8'), kdfParams);
  }

  throw new Error('unknown key encoding: ' + coding);  // will not happen
}

function looksLikePem(s) {
  s = s.trim();
  let looksLike =
    (s.startsWith('-----BEGIN PRIVATE KEY-----') &&
     s.endsWith('-----END PRIVATE KEY-----')) ||
    (s.startsWith('-----BEGIN PUBLIC KEY-----') &&
     s.endsWith('-----END PUBLIC KEY-----')) ||
    (s.startsWith('-----BEGIN RSA PUBLIC KEY-----') &&
     s.endsWith('-----END RSA PUBLIC KEY-----')) ||
    (s.startsWith('-----BEGIN RSA PRIVATE KEY-----') &&
     s.endsWith('-----END RSA PRIVATE KEY-----'));
  return looksLike;
}

function looksLikeJwks(s) {
  try {
    s = JSON.parse(s);
    return ((s.keys) && (s.keys.length > 0) && s.keys[0].kty) ? s : null;
  }
  catch (exc1) {
    return false;
  }
}

function getPrivateKey() {
  editors.privatekey.save();
  let keyvalue = $('#ta_privatekey').val().trim();
  return jose.JWK.asKey(keyvalue, "pem");
}

function getPublicKey(header) {
  editors.publickey.save();
  let fieldvalue = $('#ta_publickey').val().trim();
  if (looksLikePem(fieldvalue)) {
    return jose.JWK.asKey(fieldvalue, "pem");
  }

  return jose.JWK.asKeyStore(fieldvalue)
      .then(keystore => keystore.get(header));
}

// function currentKid() {
//   let s = (new Date()).toISOString(); // ex: 2019-09-04T21:29:23.428Z
//   let re = new RegExp('[-:TZ\\.]', 'g');
//   return s.replace(re, '');
// }

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function copyToClipboard(event) {
  let $elt = $(this),
      sourceElement = $elt.data('target'),
      // grab the element to copy
      $source = $('#' + sourceElement),
      // Create a temporary hidden textarea.
      $temp = $("<textarea>");

  if (editors[sourceElement]) {
    editors[sourceElement].save();
  }

  //let textToCopy = $source.val();
  // in which case do I need text() ?
  let sourceType = $source[0].tagName;
  let textToCopy = (sourceType == 'TEXTAREA' || sourceType.tagName == 'INPUT') ? $source.val() : $source.text();

  $("body").append($temp);
  $temp.val(textToCopy).select();
  let success;
  try {
    success = document.execCommand("copy");

    //if (success)
      // Animation to indicate copy.
      // CodeMirror obscures the original textarea, and appends a div as the next sibling.
      // We want to flash THAT.
      let $cmdiv = $source.next();
      if ($cmdiv.prop('tagName').toLowerCase() == 'div' && $cmdiv.hasClass('CodeMirror')) {
        // There seems to be  a bug in Chrome which recomputes the font size, seemingly incorrectly,
        // after removing the copy-to-clipboard-flash-bg class. So this logic just leaves it there.
        // It needs to be removed _prior_ to adding it the next time.

        // $cmdiv
        //   .removeClass('dummy')
        //   .addClass('copy-to-clipboard-flash-bg')
        //   .delay('1200')
        //   .queue( _ => $cmdiv
        //           .removeClass('copy-to-clipboard-flash-bg')
        //           .dequeue() )
        //   .delay('3')
        //   .queue( _ => $cmdiv
        //           .addClass('dummy')
        //           .dequeue() );
        $cmdiv
          .removeClass('copy-to-clipboard-flash-bg')
          .delay('6')
          .queue( _ => $cmdiv
                  .addClass('copy-to-clipboard-flash-bg')
                  .dequeue() );
      }
      else {
        // no codemirror (probably the secretkey field, which is just an input)
        $source.addClass('copy-to-clipboard-flash-bg');
        setTimeout( _ => $source.removeClass('copy-to-clipboard-flash-bg'), 1800);

        // $source.addClass('copy-to-clipboard-flash-bg')
        //   .delay('1800')
        //   .queue( _ => $source.removeClass('copy-to-clipboard-flash-bg').dequeue() );

        // $source
        //   .removeClass('copy-to-clipboard-flash-bg')
        //   .delay('6')
        //   .queue( _ => $source.addClass('copy-to-clipboard-flash-bg').dequeue() );
      }

  }

  catch (e) {
    success = false;
  }
  $temp.remove();
  return success;
}

function getAcceptableSigningAlgs(key) {
  let keytype = key.kty;
  if (keytype == 'oct') return hmacSigningAlgs;
  if (keytype == 'RSA') return rsaSigningAlgs;
  if (keytype == 'EC') {
    if (key.length == 256)
      return ['ES256'];
    if (key.length == 384)
      return ['ES384'];
    if (key.length == 521)
      return ['ES512'];
  }
  return ["NONE"];
}

const isAppropriateSigningAlg = (alg, key) => getAcceptableSigningAlgs(key).indexOf(alg)>=0;

const isAppropriateEncryptingAlg = (alg, key) => getAcceptableEncryptionAlgs(key).indexOf(alg)>=0;

function getAcceptableEncryptionAlgs(key) {
  let keytype = key.kty;
  if (keytype == 'RSA') return rsaKeyEncryptionAlgs;
  if (keytype == 'oct') return pbes2KeyEncryptionAlgs; // eventually extend this to dir, A128KW, etc
  if (keytype == 'EC') return ecdhKeyEncryptionAlgs;
  return ["NONE"];
}

const pickSigningAlg = (key) => selectRandomValue(getAcceptableSigningAlgs(key));

const pickKeyEncryptionAlg = (key) => selectRandomValue(getAcceptableEncryptionAlgs(key));

const pickContentEncryptionAlg = () => datamodel['sel-enc'] || selectRandomValue(contentEncryptionAlgs);

const isSymmetric = (alg) => alg.startsWith('HS');

function checkKeyLength(alg, keybuffer) {
  let length = keybuffer.byteLength;
  let requiredLength = algToKeyBits(alg) / 8;
  if (length >= requiredLength) return Promise.resolve(keybuffer);
  return Promise.reject(new Error('insufficient key length. You need at least ' + requiredLength + ' chars for ' + alg));
}

function encodeJwt(event) {
  let values = {}, parseError;
  ['header', 'payload'].forEach( segment => {
    let elementId = 'token-decoded-' + segment;
    if (editors[elementId]) {
      editors[elementId].save();
      let text = $('#' + elementId).val();
      try {
        values[segment] = JSON.parse(text);
      }
      catch(e) {
        parseError = segment;
      }
    }
  });
  if (parseError) {
    setAlert("cannot parse JSON ("+parseError+")", 'warning');
    return;
  }

  let {header, payload} = values;
  if (!header.typ) { header.typ = "JWT"; }

  // optionally set expiry in payload
  let desiredExpiryOverride = $('.sel-expiry').find(':selected').text().toLowerCase();
  if (desiredExpiryOverride == "no expiry") {
    delete payload.exp;
  }
  else {
    let matches = (new RegExp('^([1-9][0-9]*) (minutes|seconds)$')).exec(desiredExpiryOverride);
    if (matches && matches.length == 3) {
      let now = Math.floor((new Date()).valueOf() / 1000),
          factor = (matches[2] == 'minutes') ? 60 : 1;
      // the following may override an explicitly-provided value
      payload.exp = now + parseInt(matches[1], 10) * factor;
    }
  }

  let wantIssuedTime = $('#chk-iat').prop('checked');
  if (wantIssuedTime) {
    payload.iat = Math.floor((new Date()).valueOf() / 1000);
  }

  let p = null;
  if (header.enc && header.alg) {
    // create encrypted JWT
    if (pbes2KeyEncryptionAlgs.indexOf(header.alg) >= 0) {
      // overwrite the header values with values from the inputs
      header.p2c = getPbkdf2IterationCount();
      header.p2s = getPbkdf2SaltBuffer().toString('base64');

      let keyBuffer = Buffer.from($('#ta_symmetrickey').val(), 'utf-8');
      p = jose.JWK.asKey({ kty:'oct', k: keyBuffer, use: 'enc' });
    }
    else {
      p = getPublicKey(header);
    }

    p = p
      .then( encryptingKey => {
        if ( ! isAppropriateEncryptingAlg(header.alg, encryptingKey)) {
          throw new Error('the alg specified in the header is not compatible with the provided key. Maybe generate a fresh one?');
        }
        let encryptOptions = {alg: header.alg, fields: header, format: 'compact'},
            // createEncrypt will automatically inject the kid, unless I pass reference:false
            cipher = jose.JWE.createEncrypt(encryptOptions, [{key:encryptingKey, reference:false}]);
        cipher.update(JSON.stringify(payload), "utf8");
        return cipher.final();
      });
  }
  else {
    // create signed JWT
    if (isSymmetric(header.alg)) {
      p = getSymmetricKeyBuffer(header.alg)
        .then( keyBuffer => checkKeyLength(header.alg, keyBuffer))
        .then( keyBuffer => jose.JWK.asKey({ kty:'oct', k: keyBuffer, use: "sig" }));
    }
    else {
      p = getPrivateKey();
    }
    p = p
    .then( signingKey => {
      if (!header.alg) { header.alg = pickSigningAlg(signingKey); }
      if ( ! isAppropriateSigningAlg(header.alg, signingKey)) {
        throw new Error('the alg specified in the header is not compatible with the provided key. Maybe generate a fresh one?');
      }
      let signOptions = {
            alg: header.alg,
            fields: header,
            format: 'compact'
          };
      // use reference:false to omit the kid from the header
      let signer = jose.JWS.createSign(signOptions, [{key:signingKey, reference:false}]);
      signer.update(JSON.stringify(payload), "utf8");
      return signer.final();
    });
  }

  return p
    .then( jwt => {
      //editors.encodedjwt.setValue(jwt);
      $('#panel_encoded > p > span.length').text('(' + jwt.length + ' bytes)');
      editors.encodedjwt.setValue(jwt);
      editors.encodedjwt.save();
      if ( header.enc ) {
        // re-format the decoded JSON, incl added or modified properties like kid, alg
        showDecoded(true);
        editors['token-decoded-payload'].setValue(JSON.stringify(payload, null, 2));
        setAlert("an encrypted JWT", 'info');
      }
      else {
        showDecoded();
        setAlert("a signed JWT", 'info');
      }
    })
    .then(() => {
      $('#privatekey .CodeMirror-code').removeClass('outdated');
      $('#publickey .CodeMirror-code').removeClass('outdated');
    })
    .catch( e => {
      console.log(e.stack);
      setAlert(e);
    });
}

function decodeJwt(event) {
  showDecoded();
}

function checkValidityReasons(pHeader, pPayload, acceptableAlgorithms) {
  let nowSeconds = Math.floor((new Date()).valueOf() / 1000),
      gracePeriod = 0,
      wantCheckIat = true,
      reasons = [];

  // 4. algorithm ('alg' in header) check
  if (pHeader.alg === undefined) {
    reasons.push('the header lacks the required alg property');
  }

  if (acceptableAlgorithms.indexOf(pHeader.alg) < 0) {
    reasons.push(`the algorithm is (${pHeader.alg}) not acceptable`);
  }

  // 8.1 expired time 'exp' check
  if (pPayload.exp !== undefined && typeof pPayload.exp == "number") {
    let expiry = new Date(pPayload.exp * 1000),
        expiresString = expiry.toISOString(),
        delta = nowSeconds - pPayload.exp,
        timeUnit = quantify(delta, 'seconds');
    if (delta > 0) {
      reasons.push(`the expiry time (${expiresString}) is in the past, ${delta} ${timeUnit} ago`);
    }
  }

  // 8.2 not before time 'nbf' check
  if (pPayload.nbf !== undefined && typeof pPayload.nbf == "number") {
    let notBefore = new Date(pPayload.nbf * 1000),
        notBeforeString = notBefore.toISOString(),
        delta = pPayload.nbf - nowSeconds,
        timeUnit = quantify(delta, 'seconds');
    if (delta > 0) {
      reasons.push(`the not-before time (${notBeforeString}) is in the future, in ${delta} ${timeUnit}`);
    }
  }

  // 8.3 issued at time 'iat' check
  if (wantCheckIat) {
    if (pPayload.iat !== undefined && typeof pPayload.iat == "number") {
    let issuedAt = new Date(pPayload.iat * 1000),
        issuedAtString = issuedAt.toISOString(),
        delta = pPayload.iat - nowSeconds,
        timeUnit = quantify(delta, 'seconds');
      if (delta > 0) {
        reasons.push(`the issued-at time (${issuedAtString}) is in the future, in ${delta} ${timeUnit}`);
      }
    }
  }
  return reasons;
}

function verifyJwt(event) {
  editors.encodedjwt.save();
  editors.publickey.save();
  let tokenString = editors.encodedjwt.getValue(),
      matches = re.signed.jwt.exec(tokenString);
  // verify a signed JWT
  if (matches && matches.length == 4) {
    $("#mainalert").addClass('fade').removeClass('show');
    let json = atob(matches[1]);  // base64-decode
    let header = JSON.parse(json);
    let p = null;

    if (isSymmetric(header.alg)) {
      p = getSymmetricKeyBuffer(header.alg)
        .then( keyBuffer => checkKeyLength(header.alg, keyBuffer))
        .then( keyBuffer => jose.JWK.asKey({kty:'oct', k: keyBuffer, use:'sig'}));
    }
    else {
      p = getPublicKey(header);
    }

    return p
      .then( key =>
             jose.JWS.createVerify(key)
             .verify(tokenString)
             .then( result => {
               // {result} is a Object with:
               // *  header: the combined 'protected' and 'unprotected' header members
               // *  payload: Buffer of the signed content
               // *  signature: Buffer of the verified signature
               // *  key: The key used to verify the signature

               let parsedPayload = JSON.parse(result.payload),
                   reasons = checkValidityReasons(result.header, parsedPayload, getAcceptableSigningAlgs(key));
               if (reasons.length == 0) {
                 let message = 'The JWT signature has been verified and the times are valid. Algorithm: ' + result.header.alg;
                 showDecoded();
                 if (event) {
                   setAlert(message, 'success');
                 }
                 selectAlgorithm(result.header.alg);
                 $('#privatekey .CodeMirror-code').removeClass('outdated');
                 $('#publickey .CodeMirror-code').removeClass('outdated');
               }
               else {
                 let label = (reasons.length == 1)? 'Reason' : 'Reasons';
                 setAlert('The signature verifies, but the JWT is not valid. ' + label+': ' + reasons.join(', and ') + '.', 'warning');
               }
             })
             .catch( e => {
               setAlert('Verification failed. Bad key? ' + e.message);
             }))
      .catch( e => {
        setAlert('error verifying: ' + e.message);
      });
  }

  // verification/decrypt of encrypted JWT
  matches = re.encrypted.jwt.exec(tokenString);
  if (matches && matches.length == 6) {
    let p = null;
    let json = atob(matches[1]);  // base64-decode
    let header = JSON.parse(json);

    if (pbes2KeyEncryptionAlgs.indexOf(header.alg) >= 0) {
      let password = $('#ta_symmetrickey').val();
      let keyBuffer = Buffer.from(password, 'utf-8');
      p = jose.JWK.asKey({ kty:'oct', k: keyBuffer, use: 'enc' });
    }
    else {
      p = getPrivateKey();
    }

    return p
      .then( decryptionKey =>
             jose.JWE.createDecrypt(decryptionKey)
             .decrypt(tokenString)
             .then( result => {
               // {result} is a Object with:
               // *  header: the combined 'protected' and 'unprotected' header members
               // *  protected: an array of the member names from the "protected" member
               // *  key: Key used to decrypt
               // *  payload: Buffer of the decrypted content
               // *  plaintext: Buffer of the decrypted content (alternate)
               let td = new TextDecoder('utf-8'),
                   stringPayload = td.decode(result.payload),
                   parsedPayload = JSON.parse(stringPayload),
                   prettyPrintedJson = JSON.stringify(parsedPayload,null,2),
                   reasons = checkValidityReasons(result.header, parsedPayload, getAcceptableEncryptionAlgs(decryptionKey)),
                   elementId = 'token-decoded-payload',
                   flavor = 'payload';
               editors[elementId].setValue(prettyPrintedJson);
               $('#' + flavor + ' > p > .length').text('( ' + stringPayload.length + ' bytes)');
               if (reasons.length == 0) {
                 let message = "The JWT has been decrypted successfully, and the times are valid.";
                 if (event) {
                   setAlert(message, 'success');
                 }
                 $('#privatekey .CodeMirror-code').removeClass('outdated');
                 $('#publickey .CodeMirror-code').removeClass('outdated');
               }
               else {
                 let label = (reasons.length == 1)? 'Reason' : 'Reasons';
                 setAlert('The JWT is not valid. ' + label+': ' + reasons.join(', and ') + '.', 'warning');
               }
               return {};
             }))
      .catch( e => {
        setAlert('Decryption failed. Bad key?');
        console.log('During decryption: ' + e);
        console.log(e.stack);
      });
  }
}

function setAlert(html, alertClass) {
  let buttonHtml = '<button type="button" class="close" data-dismiss="alert" aria-label="Close">\n' +
    ' <span aria-hidden="true">&times;</span>\n' +
    '</button>',
      $mainalert = $("#mainalert");
  $mainalert.html(html + buttonHtml);
  if (alertClass) {
    $mainalert.removeClass('alert-warning'); // this is the default
    $mainalert.addClass('alert-' + alertClass); // success, primary, warning, etc
  }
  else {
    $mainalert.addClass('alert-warning');
  }
  // show()
  $mainalert.removeClass('fade').addClass('show');
  $("#mainalert").css('z-index', 99);
  setTimeout(() => {
    $("#mainalert").addClass('fade').removeClass('show');
    setTimeout(() => $("#mainalert").css('z-index', -1), 800);
  }, 5650);
}

function closeAlert(event) {
  $("#mainalert").addClass('fade').removeClass('show');
  setTimeout(() => $("#mainalert").css('z-index', -1), 800);
  return false; // Keep close.bs.alert event from removing from DOM
}

function updateKeyValue(flavor /* public || private */, keyvalue) {
  let editor = editors[flavor+'key'];
  if (editor) {
    editor.setValue(keyvalue);
    editor.save();
    saveSetting('ta_'+ flavor +'key', keyvalue);
  }
}

function key2pem(flavor, keydata) {
  let body = window.btoa(String.fromCharCode(...new Uint8Array(keydata)));
  body = body.match(/.{1,64}/g).join('\n');
  return `-----BEGIN ${flavor} KEY-----\n${body}\n-----END ${flavor} KEY-----`;
}

function getGenKeyParams(alg) {
  if (alg.startsWith('RS') || alg.startsWith('PS')) return {
    name: "RSASSA-PKCS1-v1_5", // this name also works for RSA-PSS !
    modulusLength: 2048, //can be 1024, 2048, or 4096
    publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
    hash: {name: "SHA-256"}
  };
  // signing with EC keys
  if (alg == 'ES256') return { name: "ECDSA", namedCurve: 'P-256' };
  if (alg == 'ES384') return { name: "ECDSA", namedCurve: 'P-384' };
  if (alg == 'ES512') return { name: "ECDSA", namedCurve: 'P-521' };
  // encrypting with EC keys (ECDH)
  // TODO: determine if we need to support other keys here
  // TODO: determine if we want to support other curves. can be "P-256", "P-384", or "P-521"
  if (alg.startsWith('ECDH')) return { name: "ECDH", namedCurve: 'P-256'};
  throw new Error('invalid key flavor');
}

function maybeNewKey() {
  let alg = $('.sel-alg').find(':selected').text();
  if (alg.startsWith('HS') || alg.startsWith('PB')) {
    if ( ! $('#ta_symmetrickey').val()) {
      return newKey(null);
    }
  }
  else {
    editors.privatekey.save();
    editors.publickey.save();
    let privatekey = $('#ta_privatekey').val().trim(),
        publickey = $('#ta_publickey').val().trim();
    if ( ! privatekey || !publickey) {
      return newKey(null);
    }
  }
  return Promise.resolve({});
}

const getKeyUse = (alg) => (alg.startsWith('ECDH')) ? ['deriveKey', 'deriveBits'] : ['sign', 'verify'] ;

function newKey(event) {
  let alg = $('.sel-alg').find(':selected').text();
  if (alg.startsWith('HS') || alg.startsWith('PB')) {
    let coding = $('.sel-symkey-coding').find(':selected').text().toLowerCase();
    let keyString = null;
    if (coding == 'utf-8' || coding == 'pbkdf2') {
      keyString = randomPassword();
    }
    else if (coding == 'base64' || coding == 'hex') {
      keyString = Buffer.from(randomOctetKey()).toString(coding);
    }
    if (keyString) {
      $('#ta_symmetrickey').val(keyString);
      saveSetting('ta_symmetrickey', keyString); // for reload
    }
    return Promise.resolve({});
  }

  // this works with either EC or RSA key types
  let keyUse = getKeyUse(alg),
  isExtractable = true,
  genKeyParams = getGenKeyParams(alg);
  return window.crypto.subtle.generateKey(genKeyParams, isExtractable, keyUse)
    .then(key =>
          window.crypto.subtle.exportKey( "spki", key.publicKey )
          .then(keydata => updateKeyValue('public', key2pem('PUBLIC', keydata)) )
          .then( () => window.crypto.subtle.exportKey( "pkcs8", key.privateKey ))
          .then(keydata => updateKeyValue('private', key2pem('PRIVATE', keydata)) ))
    .then( () => {
      $('#mainalert').removeClass('show').addClass('fade');
      $('#privatekey .CodeMirror-code').removeClass('outdated');
      $('#publickey .CodeMirror-code').removeClass('outdated');
      // why only publickey, not also privatekey?
      editors.publickey.setOption('mode', 'encodedjwt');
      return {}; })
    .catch( e => console.log(e));
}

function selectAlgorithm(algName) {
  let currentlySelectedAlg = $('.sel-alg').find(':selected').text().toLowerCase();
  if (algName.toLowerCase() != currentlySelectedAlg) {
    let $option = $('.sel-alg option[value="'+ algName +'"]');
    if ( ! $option.length) {
      $option = $('.sel-alg option[value="??"]');
    }
    $option
      .prop('selected', true)
      .trigger("change");
  }
}

function selectEnc(encName) {
  let currentlySelectedEnc = $('.sel-enc').find(':selected').text().toLowerCase();
  if (encName.toLowerCase() != currentlySelectedEnc) {
    let $option = $('.sel-enc option[value="'+ encName +'"]');
    if ( ! $option.length) {
      $option = $('.sel-enc option[value="??"]');
    }
    $option
      .prop('selected', true)
      .trigger("change");
  }
}

function showDecoded(skipEncryptedPayload) {
  editors.encodedjwt.save();

  let tokenString = editors.encodedjwt.getValue(), //$('#encodedjwt').val(),
      matches = re.signed.jwt.exec(tokenString);
  saveSetting('encodedjwt', tokenString); // for reload
  $('#panel_encoded > p > span.length').text('(' + tokenString.length + ' bytes)');

  if (matches && matches.length == 4) {
    setAlert("looks like a signed JWT", 'info');
    let currentlySelectedVariant = $('.sel-variant').find(':selected').text().toLowerCase();
    if (currentlySelectedVariant != "signed") {
      $('.sel-variant option[value=Signed]')
        .prop('selected', true)
        .trigger("change");
      setTimeout( () => onChangeVariant(), 2);
    }

    let flavors = ['header','payload']; // cannot decode signature
    matches.slice(1,-1).forEach(function(item,index) {
      let json = atob(item),  // base64-decode
          flavor = flavors[index],
          elementId = 'token-decoded-' + flavor;
      try {
        let obj = JSON.parse(json), // may throw
            prettyPrintedJson = JSON.stringify(obj,null,2),
            flatJson = JSON.stringify(obj);
        editors[elementId].setValue(prettyPrintedJson);
        $('#' + flavor + ' > p > .length').text('(' + flatJson.length + ' bytes)');
        if (flavor == 'header' && obj.alg) {
          selectAlgorithm(obj.alg);
        }
      }
      catch (e) {
        // probably not json
        setAlert("the "+ flavor +" may not be valid JSON", 'info');
        editors[elementId].setValue(json);
      }
    });
    return;
  }

  matches = re.encrypted.jwt.exec(tokenString);
  if (matches && matches.length == 6) {
    setAlert("an encrypted JWT", 'info');
    let currentlySelectedVariant = $('.sel-variant').find(':selected').text().toLowerCase();
    if (currentlySelectedVariant != "encrypted") {
      $('.sel-variant option[value=Encrypted]')
        .prop('selected', true)
        .trigger("change"); //.trigger seems not to work?
      setTimeout( () => onChangeVariant(), 2);
    }
    // Display the decoded header.
    // Not possible to 'decode' the payload; it requires decryption.
    try {
      let item = matches[1],
          json = atob(item),  // base64-decode
          obj = JSON.parse(json),
          prettyPrintedJson = JSON.stringify(obj,null,2),
          flatJson = JSON.stringify(obj);
      editors['token-decoded-header'].setValue(prettyPrintedJson);
      $('#header > p > .length').text('(' + flatJson.length + '' + 'bytes)');
      if ( ! skipEncryptedPayload) {
        // Just display a fixed value.
        // Must decrypt the ciphertext payload to display claims,
        // and it's not possible to decrypt just now.
        editors['token-decoded-payload'].setValue('?ciphertext?');
        $('#payload > p > .length').text('( ' + matches[2].length + ' bytes)');
      }
      if (obj.alg) {
        selectAlgorithm(obj.alg);
      }
      if (obj.enc) {
        selectEnc(obj.enc);
      }
    }
    catch (e) {
      // probably not json
      setAlert("the header may not be valid JSON", 'info');
      editors['token-decoded-header'].setValue('??');
    }

    // do not attempt decrypt here
    return;
  }

  setAlert("That does not appear to be a JWT");
}

function populateEncSelectOptions() {
  $.each(contentEncryptionAlgs, (val, text) =>
         $('.sel-enc').append( $('<option></option>').val(text).html(text) ));
}

function populateAlgorithmSelectOptions() {
  let variant = $('.sel-variant').find(':selected').text().toLowerCase(),
      $selAlg = $('.sel-alg');
  $selAlg.find('option').remove();
  let a = (variant == 'signed') ? signingAlgs : keyEncryptionAlgs;
  $.each(a, (val, text) =>
         $selAlg.append( $('<option></option>').val(text).html(text) ));

  let headerObj = getHeaderFromForm();
  if (headerObj && headerObj.alg) {
    // select that one
    let $option =
      $selAlg.find("option[value='"+headerObj.alg+"']");
    if ($option.length) {
        $option.prop('selected', 'selected');
      saveSetting('sel-alg-' + variant, headerObj.alg);
    }
    else {
    // pull from data model and select that
    let value = datamodel['sel-alg-' + variant];
    $selAlg.find("option[value='"+value+"']").prop('selected', 'selected');
    }
  }
  else {
    // pull from data model and select that
    let value = datamodel['sel-alg-' + variant];
    $selAlg.find("option[value='"+value+"']").prop('selected', 'selected');
  }
  // store currently selected alg:
  //$( '.sel-alg').data("prev", $( '.sel-alg').find(':selected').text());

  $('.sel-alg').data("prev", 'NONE'); // do we always want this?

  // $('.sel-alg').trigger('change'); // not sure why this does not work
  //onChangeAlg.call(document.getElementsByClassName('sel-alg')[0], null);
  // dino - 20201222-1115 - maybe
  //onChangeAlg.call(document.querySelector('.sel-alg'), null);
  setTimeout( () => onChangeAlg(), 2);
}

function keysAreCompatible(alg1, alg2) {
  let prefix1 = alg1.substring(0, 2),
      prefix2 = alg2.substring(0, 2);
  if (['RS', 'PS'].indexOf(prefix1)>=0 &&
      ['RS', 'PS'].indexOf(prefix2)>=0 ) return true;
  if (prefix1 == 'ES') return alg1 == alg2;
  return false;
}

function changeSymmetricKeyCoding(event) {
  let $this = $(this),
      newSelection = $this.find(':selected').text(),
      previousSelection = $this.data('prev');
  if (newSelection != previousSelection) {
    $('#ta_symmetrickey').addClass('outdated');
    if (newSelection == 'PBKDF2') {
      // display the salt and iteration count
      $('#pbkdf2_params').show();
    }
    else {
      $('#pbkdf2_params').hide();
    }
  }
  $this.data('prev', newSelection);
  saveSetting('sel-symkey-coding', newSelection);
}

function checkSymmetryChange(newalg, oldalg) {
  let newPrefix = newalg.substring(0, 2),
      oldPrefix = oldalg && oldalg.substring(0, 2);
  if (newPrefix == 'HS' || newPrefix == 'PB') {
    //$('.btn-newkeypair').hide();
    if (oldPrefix != 'HS' & oldPrefix != 'PB') {
      $('#privatekey').hide();
      $('#publickey').hide();
      $('#symmetrickey').show();

      if (newPrefix == 'PB') {
        //$('.sel-symkey-coding').disable(); // always PBKDF2!
        let currentlySelectedCoding = $('.sel-symkey-coding').find(':selected').text().toLowerCase();
        if (currentlySelectedCoding != "pbkdf2") {
          $('.sel-symkey-coding option[value=PBKDF2]')
            .prop('selected', true)
            .trigger("change");
        }
        $('.sel-symkey-coding').prop("disabled", true);
      }
      else {
        // $('.sel-symkey-coding').enable();
        $('.sel-symkey-coding').prop("disabled", false);
      }
      return true;
    }
  }
  else {
    //$('.btn-newkeypair').show();
    if (newPrefix == 'RS' || newPrefix == 'PS' || newPrefix == 'ES' || newPrefix == 'EC') {
      $('#privatekey').show();
      $('#publickey').show();
      $('#symmetrickey').hide();
      return true;
    }
  }
}

function initialized() {
  return !!editors['token-decoded-header'];
}

function onChangeIat(event) {
  let wantIat = $('#chk-iat').prop('checked');
  saveSetting('chk-iat', String(wantIat));
}

function onChangeExpiry(event) {
  let $this = $(this),
      selectedExpiry = $this.find(':selected').text();
  saveSetting('sel-expiry', selectedExpiry);
}

function getHeaderFromForm() {
  let headerText = $('#token-decoded-header').val();
  if (headerText) {
    try {
      return JSON.parse(headerText);
    }
    catch (e) {
      console.log('invalid header');
    }
  }
}

function onChangeEnc(event) {
  let $this = $('#sel-enc'),
      newSelection = $this.find(':selected').text(),
      previousSelection = $this.data('prev'),
      headerObj = null;

  if ( ! initialized()) { return ; }
  if (newSelection != previousSelection) {

    // apply newly selected enc to the displayed header
    editors['token-decoded-header'].save();
    try {
      headerObj = getHeaderFromForm();
      headerObj.enc = newSelection;
      editors['token-decoded-header'].setValue(JSON.stringify(headerObj, null, 2));
      saveSetting('sel-enc', newSelection);
    }
    catch (e) {
      /* gulp */
      console.log('while updating header enc', e);
    }
  }
}

function onChangeAlg(event) {
  let $this = $('#sel-alg'),
      //$this = $(this),
      newSelection = $this.find(':selected').text(),
      previousSelection = $this.data('prev'),
      headerObj = null;

  if ( ! initialized()) { return ; }

  maybeNewKey()
    .then( _ => {
      if (newSelection != previousSelection) {

        checkSymmetryChange(newSelection, previousSelection);

        // apply newly selected alg to the displayed header
        editors['token-decoded-header'].save();
        try {
          headerObj = getHeaderFromForm();
          headerObj.alg = newSelection;
          editors['token-decoded-header'].setValue(JSON.stringify(headerObj, null, 2));
        }
        catch (e) {
          /* gulp */
          console.log('while updating header alg', e);
        }

        if ( ! keysAreCompatible(newSelection, previousSelection)) {
          $('#privatekey .CodeMirror-code').addClass('outdated');
          $('#publickey .CodeMirror-code').addClass('outdated');
        }
        $this.data('prev', newSelection);
      }
      if (newSelection.startsWith('PB')) {
        if (headerObj){
          $('#ta_pbkdf2_iterations').val(headerObj.p2c);
          $('#ta_pbkdf2_salt').val(headerObj.p2s);
          // always base64
          $('.sel-symkey-pbkdf2-salt-coding option[value="Base64"]')
            .prop('selected', true)
            .trigger("change");
          // user can change these but it probably won't work
        }
      }
      else {
        // nop
      }
      let variant = $('#sel-variant').find(':selected').text().toLowerCase();
      saveSetting('sel-alg-' + variant, newSelection);
    });
}

function onChangeVariant(event) {
  // change signed to encrypted or vice versa
  let $this = $('#sel-variant'),
      //$this = $(this),
      newSelection = $this.find(':selected').text(),
      previousSelection = $this.data('prev'),
      priorAlgSelection = $('.sel-alg').data('prev');

  editors['token-decoded-header'].save();

  if (newSelection != previousSelection) {
    try {
      let headerObj = getHeaderFromForm();
      if (newSelection == 'Encrypted') {
        // swap in alg and enc
        if ( ! headerObj.alg) {
          headerObj.alg = pickKeyEncryptionAlg({kty:'RSA'}); // not always !
        }
        if ( ! headerObj.enc) {
          headerObj.enc = pickContentEncryptionAlg();
        }
        $('#sel-enc').show();
        $('#privatekey').show();
        $('#publickey').show();
        $('#symmetrickey').hide(); // why presume asymmetric alg?
      }
      else {
        $('#sel-enc').hide(); // not used for signing
        // select an appropriate alg and remove enc
        headerObj.alg = pickSigningAlg({kty:'RSA'});
        // these fields can never be used with signed JWT
        delete headerObj.enc;
        delete headerObj.p2s;
        delete headerObj.p2c;
        delete headerObj.epk;
        // populateAlgorithmSelectOptions() - called below - will trigger the
        // onChangeAlg fn which will do the right thing for symmetry change, etc.
      }
      editors['token-decoded-header'].setValue(JSON.stringify(headerObj, null, 2));
    }
    catch(e) {
      /* gulp */
    }
    $this.data('prev', newSelection);
  }

  populateAlgorithmSelectOptions();

  // This used to be appropriate logic, but since adding PBES2, at
  // least the comment is no longer accurate.  In any case things seem to be working.

  // There are two possibilities:
  // 1. change from signed to encrypted, in which case we always need RSA keys.
  // 2. change from encrypted to signed, in which case RS256 gets selected and again we need RSA keys.
  // So just check if the prior alg was RSA.
  if ( !priorAlgSelection.startsWith('PS') && !priorAlgSelection.startsWith('RS')) {
    $('#privatekey .CodeMirror-code').addClass('outdated');
    $('#publickey .CodeMirror-code').addClass('outdated');
  }
  saveSetting('sel-variant', newSelection);
}

function contrivePayload() {
    let nowSeconds = Math.floor((new Date()).valueOf() / 1000),
        sub = selectRandomValue(sampledata.names),
        aud = selectRandomValueExcept(sampledata.names, sub),
        payload = {
          iss:"DinoChiesa.github.io",
          sub,
          aud,
          iat: nowSeconds,
          exp: nowSeconds + tenMinutesInSeconds // always
        };
  if (randomBoolean()) {
    let propname = selectRandomValue(sampledata.props);
    payload[propname] = generateRandomValue(null, null, propname);
  }
  return payload;
}

function contriveHeader() {
  let header = { alg : $('.sel-alg').find(':selected').text() };
  if ( keyEncryptionAlgs.indexOf(header.alg) >=0) {
    if ( ! header.enc ) {
      header.enc = selectRandomValue(contentEncryptionAlgs);
    }
  }
  if (randomBoolean()) {
    header.typ = 'JWT';
  }
  if (randomBoolean()) {
    let propname = selectRandomValue(sampledata.props),
        type = selectRandomValueExcept(sampledata.types, ['array', 'object']);
    header[propname] = generateRandomValue(type, 0, propname);
  }
  return header;
}

function newPayload(event) {
  let payload = contrivePayload(),
      elementId = 'token-decoded-payload';
  editors[elementId].setValue(JSON.stringify(payload,null,2));
}

function newHeader(event) {
  let payload = contriveHeader(),
      elementId = 'token-decoded-header';
  editors[elementId].setValue(JSON.stringify(payload,null,2));
}

function contriveJwt(event) {
  let payload = contrivePayload(),
      header = contriveHeader();
  editors['token-decoded-header'].setValue(JSON.stringify(header));
  editors['token-decoded-payload'].setValue(JSON.stringify(payload));
  encodeJwt(event);
}

function decoratePayloadLine(instance, handle, lineElement) {
  let lastComma = new RegExp(',\s*$');
  $(lineElement).find('span.cm-property').each( (ix, element) => {
    let $this = $(element), text = $this.text();
    if (['"exp"', '"iat"', '"nbf"'].indexOf(text) >= 0) {
      let $valueSpan = $this.nextAll('span').first(),
          text = $valueSpan.text().replace(lastComma, ''),
          time = new Date(Number(text) * 1000),
          stringRep = time.toISOString();
      $valueSpan.attr('title', stringRep);
    }
  });
}

function looksLikeJwt(possibleJwt) {
  if ( ! possibleJwt) return false;
  if (possibleJwt == '') return false;
  let matches = re.signed.jwt.exec(possibleJwt);
  if (matches && matches.length == 4) { return true; }
  matches = re.encrypted.jwt.exec(possibleJwt);
  if (matches && matches.length == 6) { return true; }
  return false;
}

function retrieveLocalState() {
    Object.keys(datamodel)
    .forEach(key => {
      var value = storage.get(key);
      if (key.startsWith('chk-')) {
        datamodel[key] = Boolean(value);
      }
      else {
        datamodel[key] = value;
      }
    });
}

function saveSetting(key, value) {
  if (key == 'sel-alg') {
    key = key + '-' + datamodel['sel-variant'].toLowerCase();
  }
  datamodel[key] = value;
  storage.store(key, value);
}

function applyState() {
    Object.keys(datamodel)
    .forEach(key => {
      var value = datamodel[key];
      if (value) {
        var $item = $('#' + key);
        if (key.startsWith('sel-alg-')) {
          // selection of alg, stored separately for signing and encrypting
          let currentlySelectedVariant = $('.sel-variant').find(':selected').text().toLowerCase(),
              storedVariant = key.substr(8);
          if (storedVariant == currentlySelectedVariant) {
            $item = $('#sel-alg');
            $item.find("option[value='"+value+"']").prop('selected', 'selected');
          }
        }
        else if (key.startsWith('sel-')) {
          // selection
          $item.find("option[value='"+value+"']").prop('selected', 'selected');
          if (key == 'sel-variant') {
            onChangeVariant.call(document.querySelector('#sel-variant'), null);
          }
        }
        else if (key.startsWith('chk-')) {
          $item.prop("checked", Boolean(value));
        }
        else if (key == 'encodedjwt') {
          if (value) { parseAndDisplayToken(value); }
        }
        else if (key == 'ta_publickey' || key == 'ta_privatekey') {
          let keytype = key.substr(3);
          editors[keytype].setValue(value); // will update the visible text area
        }
        else {
          $item.val(value);
        }
      }
    });
}

function reformKeyNewlines(keytype /* publickey, privatekey */) {
  editors[keytype].save();
  let fieldvalue = $('#ta_' + keytype).val()
    .replace(/\\n/g, '\n')
    .trim();
  $('#ta_' + keytype).val(fieldvalue);
  editors[keytype].save();
  return fieldvalue;
}

function parseAndDisplayToken(token) {
  editors.encodedjwt.setValue(token);
  editors.encodedjwt.save();
  showDecoded();
  $('#privatekey .CodeMirror-code').addClass('outdated');
  $('#publickey .CodeMirror-code').addClass('outdated');
}

$(document).ready(function() {
  $( '#version_id').text(BUILD_VERSION);
  $( '.btn-copy' ).on('click', copyToClipboard);
  $( '.btn-encode' ).on('click', encodeJwt);
  $( '.btn-decode' ).on('click', decodeJwt);
  $( '.btn-verify' ).on('click', verifyJwt);
  $( '.btn-newkey' ).on('click', newKey);
  $( '.btn-newpayload' ).on('click', newPayload);
  $( '.btn-newheader' ).on('click', newHeader);

  //$( '.btn-regen' ).on('click', contriveJwt);

  populateAlgorithmSelectOptions();
  populateEncSelectOptions();

  $( '.sel-symkey-coding').on('change', changeSymmetricKeyCoding);

  $('#mainalert').addClass('fade');
  $('#mainalert').on('close.bs.alert', closeAlert);

  // editor for the encoded JWT (left hand column)
  editors.encodedjwt = CodeMirror.fromTextArea(document.getElementById('encodedjwt'), {
    mode: 'encodedjwt',
    lineWrapping: true
  });
  editors.encodedjwt.on('inputRead', function(cm, event) {
    /* event -> object{
       origin: string, can be '+input', '+move' or 'paste'
       doc for origins >> http://codemirror.net/doc/manual.html#selection_origin
       from: object {line, ch},
       to: object {line, ch},
       removed: array of removed strings
       text: array of pasted strings
       } */
    if (event.origin == 'paste') {
      setTimeout(decodeJwt, 220);
    }
  });
  //editors.encodedjwt.on('renderLine', decorateEncodedToken);

  // create editors for the public and private keys
  ['private', 'public'].forEach( flavor => {
    let keytype = flavor+'key', // private || public
        elementId = 'ta_'+ keytype;
    editors[keytype] = CodeMirror.fromTextArea(document.getElementById(elementId), {
      mode: 'encodedjwt', // not really, its just plaintext
      lineWrapping: true
    });
    editors[keytype].on('inputRead', function(cm, event) {
      if (event.origin == 'paste') {
        setTimeout(function() {
          let fieldvalue = reformKeyNewlines(keytype);
          if (looksLikePem(fieldvalue)) {
            editors[keytype].setOption('mode', 'encodedjwt');
            updateKeyValue(flavor, reformIndents(fieldvalue));
          }
          else {
            let possiblyJwks = looksLikeJwks(fieldvalue);
            if (possiblyJwks) {
              editors[keytype].setOption('mode', 'javascript');
              let prettyPrintedJson = JSON.stringify(possiblyJwks,null,2);
              editors[keytype].setValue(prettyPrintedJson);
            }
            else {
              // meh, not sure what to do here
              // $('#publickey-label').text('Public Key');
              //debugger;
            }
          }
        }, 220);
      }
    });

  });

  // create CM editors for decoded (JSON) payload and header
  ['header', 'payload'].forEach( portion => {
    let elementId = 'token-decoded-' + portion;
    editors[elementId] = CodeMirror.fromTextArea(document.getElementById(elementId), {
      mode: {
        name: 'javascript',
        json: true,
        indentWithTabs: false,
        statementIndent : 2,
        indentUnit : 2,
        tabSize: 2
      }
    });
  });

  // to label fields in the decoded payload. We don't do the same in the header.
  editors['token-decoded-payload'].on('renderLine', decoratePayloadLine);
  $('#symmetrickey').hide();
  $('#pbkdf2_params').hide();

  // handle inbound query or hash
  let inboundJwt = window.location.hash,
      hash = {},
      fnStartsWith = function(s, searchString, position) {
        position = position || 0;
        return s.lastIndexOf(searchString, position) === position;
      };

  if ( ! inboundJwt || inboundJwt === '') {
    inboundJwt = window.location.search.replace('?', '');
  }

  retrieveLocalState();
  applyState();

  $( '#sel-variant').on('change', onChangeVariant);
  $( '#sel-alg').on('change', onChangeAlg);
  $( '#sel-enc').on('change', onChangeEnc);
  $( '#sel-expiry').on('change', onChangeExpiry);
  $( '#chk-iat').on('change', onChangeIat);

  if (looksLikeJwt(inboundJwt)) {
    maybeNewKey()
      .then( _ => parseAndDisplayToken(inboundJwt));
  }
  else if (datamodel.encodedjwt) {
     maybeNewKey();
  }
  else if ( ! datamodel.encodedjwt) {
    maybeNewKey()
      .then( _ => contriveJwt() );
  }

});
