'use strict';
// Presentation only. The BFF verifies the provider identity and invitation.

// Reads an email link's URL fragment. Two formats arrive here: Relay's own
// templates (token_hash) and Supabase's default links, which redirect with an
// access token or an error. Tokens are passed to the server, never trusted here.
function confirmationFromLink(hash) {
  const params = new URLSearchParams(String(hash || '').replace(/^#/, ''));
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && ['email', 'recovery'].includes(type)) return { confirmation: { tokenHash, type } };
  const accessToken = params.get('access_token');
  if (accessToken) return { confirmation: { accessToken, type: type === 'recovery' ? 'recovery' : 'email' } };
  if (params.get('error') || params.get('error_code'))
    return { error: 'That email link has expired or was already used. Enter your email to get a new one.' };
  return {};
}
function managedAuthView(){
  const kind=state.auth;
  let heading,copy,form;
  if(kind==='email-sent'){
    const recovery=state.emailAction==='recover';
    heading='Check your inbox.';copy=recovery?'If your address is eligible, you’ll receive a password-reset link. Open it to choose your new password.':'If your address is invited, you’ll receive an email with the next step. After verifying, return here and log in to continue your request.';
    form=`<form id="${recovery?'recover':'resend'}"><label for="resend-email">Email</label><input id="resend-email" name="email" type="email" value="${escape(state.email)}" autocomplete="email" required><div class="form-error" role="alert"></div><button class="primary" type="submit">${recovery?'Resend reset email':'Resend verification email'}</button></form>`;
  }else if(kind==='recover'){
    heading='Let’s get you back in.';copy='Enter your email. If the address is eligible, we’ll send a password-reset link.';
    form=`<form id="recover"><label for="recover-email">Email</label><input id="recover-email" name="email" type="email" value="${escape(state.email)}" autocomplete="email" required><div class="form-error" role="alert"></div><button class="primary" type="submit">Send reset email</button></form>`;
  }else if(kind==='confirm'){
    const recovery=state.confirmation?.type==='recovery';
    heading=recovery?'Reset your password.':'One last step.';
    copy=recovery?'Continue to verify your reset link. You’ll choose a new password next.':'Confirm your email to open your private Relay workspace.';
    form=`<form id="confirm"><div class="form-error" role="alert"></div><button class="primary" type="submit">${recovery?'Continue password reset':'Verify my email'}</button></form>`;
  }else{
    heading='Choose a new password.';copy='Use 15–128 characters. After saving, sign in again. Existing Relay sessions will be revoked.';
    form='<form id="reset"><label for="new-password">New password</label><input id="new-password" name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required><div class="form-error" role="alert"></div><button class="primary" type="submit">Save new password</button></form>';
  }
  return `<main class="auth-wrap"><div class="auth-card"><span class="eyebrow">${state.features?.pilotConnections ? 'Relay private pilot' : 'Private Relay staging'}</span><h1>${heading}</h1><p class="muted">${copy}</p>${form}<p class="switch-auth"><button class="quiet" data-action="login">Back to log in</button></p></div></main>`;
}
