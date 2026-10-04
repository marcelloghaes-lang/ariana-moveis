function on(value=''){
  return String(value||'').trim().toLowerCase()==='true';
}

function present(value=''){
  return Boolean(String(value||'').trim());
}

export function evaluateArianaPaySandboxGuard(env=process.env){
  const violations=[];

  if(on(env.ARIANA_PAY_ENABLED)) violations.push('ARIANA_PAY_ENABLED_must_be_false');
  if(on(env.ARIANA_PAY_CHECKOUT_ENABLED)) violations.push('ARIANA_PAY_CHECKOUT_ENABLED_must_be_false');
  if(on(env.ARIANA_PAY_PAYOUT_ENABLED)) violations.push('ARIANA_PAY_PAYOUT_ENABLED_must_be_false');

  const maxAmount=Number(env.ARIANA_PAY_SANDBOX_MAX_AMOUNT||100);
  if(!Number.isFinite(maxAmount)||maxAmount<=0||maxAmount>1000){
    violations.push('ARIANA_PAY_SANDBOX_MAX_AMOUNT_invalid');
  }

  return {
    ok:violations.length===0,
    violations,
    shadowEnabled:on(env.ARIANA_PAY_SHADOW_ENABLED),
    adminTokenConfigured:present(env.ARIANA_PAY_SANDBOX_ADMIN_TOKEN),
    maxAmount:Number.isFinite(maxAmount)&&maxAmount>0?Math.min(maxAmount,1000):100,
    readyForRealMoney:false
  };
}

export function assertArianaPaySandboxSafe(env=process.env){
  const result=evaluateArianaPaySandboxGuard(env);
  if(!result.ok){
    const error=new Error(`Ariana Pay sandbox recusou inicialização insegura: ${result.violations.join(', ')}`);
    error.code='ARIANA_PAY_SANDBOX_UNSAFE_CONFIGURATION';
    error.violations=result.violations;
    throw error;
  }
  return result;
}

export default {
  evaluateArianaPaySandboxGuard,
  assertArianaPaySandboxSafe
};
