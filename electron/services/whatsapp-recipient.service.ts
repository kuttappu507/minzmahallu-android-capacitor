import { getDB } from "../db/connection.js";

const normalize=(v:string)=>{const d=String(v||"").replace(/\D/g,"");return d.length===10?`91${d}`:d;};
// Effective family-head contact number: the dedicated WhatsApp number when
// set, otherwise the family's primary phone. `whatsapp_enabled` remains the
// explicit opt-out for bulk messaging either way.
const FAMILY_PHONE_SQL=`COALESCE(NULLIF(TRIM(f.whatsapp_phone), ''), NULLIF(TRIM(f.phone), ''))`;
export function recipientStats(type:"ANNOUNCEMENT"|"SUBSCRIPTION_REMINDER"){
  const db=getDB();
  const families=db.prepare(`SELECT f.id, ${FAMILY_PHONE_SQL} AS whatsapp_phone, f.whatsapp_enabled, f.status, f.house_name, f.family_number FROM families f WHERE f.status='Active'`).all() as any[];
  const active=families.length;
  const missing=families.filter(f=>!normalize(f.whatsapp_phone)).length;
  const disabled=families.filter(f=>!!normalize(f.whatsapp_phone)&&!f.whatsapp_enabled).length;
  let eligible=families.filter(f=>!!normalize(f.whatsapp_phone)&&!!f.whatsapp_enabled);
  let alreadySent=0;
  if(type==="SUBSCRIPTION_REMINDER"){
    const month=`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}`;
    const sent=db.prepare("SELECT DISTINCT family_id FROM whatsapp_campaign_recipients r JOIN whatsapp_campaigns c ON c.id=r.campaign_id WHERE c.campaign_type='SUBSCRIPTION_REMINDER' AND c.period_key=? AND r.status='SENT'").all(month) as any[];
    const sentIds=new Set(sent.map(x=>x.family_id));
    alreadySent=eligible.filter(f=>sentIds.has(f.id)).length;
    const due=db.prepare("SELECT DISTINCT family_id FROM subscriptions WHERE amount > amount_paid AND status IN ('Pending','Partial','Overdue')").all() as any[];
    const dueIds=new Set(due.map(x=>x.family_id));
    eligible=eligible.filter(f=>dueIds.has(f.id)&&!sentIds.has(f.id));
  }
  return {type,activeFamilies:active,eligible:eligible.length,missingWhatsApp:missing,disabledWhatsApp:disabled,alreadySent,willSend:eligible.length};
}
