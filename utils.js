const Input = require('input');

async function loginFlow(tg) {

  const phoneNumber = await Input.text('insert phone number');

  const { phone_code_hash } = await tg.Login.sendCode(phoneNumber);

  const code = await Input.text('insert login code');

  try {
    
    const signInResult = await tg.Login.signIn({
      code,
      phone: phoneNumber,
      phone_code_hash
    });

    console.info('login successful');

    return signInResult;

  } catch ( e ) {

    if (e.error_message !== 'SESSION_PASSWORD_NEEDED') {
      console.error(`error:`, e);
      return;
    }

    const pass2fa = await Input.password('insert password 2FA');

    const { srp_id, current_algo, srp_B } = await tg.Login.getPassword();
    const { g, p, salt1, salt2 } = current_algo;

    const { A, M1 } = await tg.mtproto.crypto.getSRPParams({
      g,
      p,
      salt1,
      salt2,
      gB: srp_B,
      password: pass2fa,
    });


    const checkPasswordResult = await tg.Login.checkPassword({ srp_id, A, M1 });

    return checkPasswordResult;
  }


}

function parseRange(header) {
  const [start, end] = header.replace('bytes=', '').split('-');

  return {
    start: start ? Number(start) : NaN,
    end: end ? Number(end) : NaN
  };
}


module.exports = {
  loginFlow,
  parseRange
}