import { NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, Home, User, Briefcase, Users, Receipt, Gift, Calculator, Gem, Flower, Activity, Award, Ticket, BarChart3, Sliders, Users as UsersIcon, FileText, Database, LogOut, ChevronRight, MessageCircle, Landmark } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useState } from "react";
const NAV=[{id:"dash",to:"/",icon:LayoutDashboard,key:"nav_dashboard"},{sec:"Management"},{id:"families",to:"/families",icon:Home,key:"nav_families"},{id:"members",to:"/members",icon:User,key:"nav_members"},{id:"staff",to:"/staff",icon:Briefcase,key:"nav_staff"},{id:"committee",to:"/committee",icon:Users,key:"nav_committee"},{id:"subs",to:"/subscriptions",icon:Receipt,key:"nav_subscriptions"},{id:"dons",to:"/donations",icon:Gift,key:"nav_donations"},{id:"whatsapp",to:"/whatsapp",icon:MessageCircle,key:"nav_whatsapp"},{sec:"Finance"},{id:"acct",to:"/accounting",icon:Calculator,key:"nav_accounting"},{id:"assets",to:"/assets",icon:Landmark,key:"nav_assets"},{sec:"Registers"},{id:"marriage",to:"/marriages",icon:Gem,key:"nav_marriage"},{id:"death",to:"/deaths",icon:Flower,key:"nav_death"},{id:"welfare",to:"/welfare",icon:Activity,key:"nav_welfare"},{id:"certs",to:"/certificates",icon:Award,key:"nav_certificates"},{id:"tokens",to:"/tokens",icon:Ticket,key:"nav_tokens"},{sec:"System"},{id:"reports",to:"/reports",icon:BarChart3,key:"nav_reports"},{id:"settings",to:"/settings",icon:Sliders,key:"nav_settings"},{id:"users",to:"/users",icon:UsersIcon,key:"nav_users"},{id:"audit",to:"/audit",icon:FileText,key:"nav_audit"},{id:"backup",to:"/backup",icon:Database,key:"nav_backup"}];
const TINTS:Record<string,string>={dash:"t-em",families:"t-em",members:"t-teal",staff:"t-vio",committee:"t-cyan",subs:"t-gold",dons:"t-pink",whatsapp:"t-teal",acct:"t-sky",assets:"t-teal",marriage:"t-vio",death:"t-slate",welfare:"t-orange",certs:"t-cyan",tokens:"t-pink",reports:"t-blue",settings:"t-vio",users:"t-blue",audit:"t-gold",backup:"t-teal"};
const sectionLabel:Record<string,string>={Management:"മാനേജ്മെന്റ്",Finance:"സാമ്പത്തികം",Registers:"രജിസ്റ്ററുകൾ",System:"സിസ്റ്റം"};
function roleLabel(role:string|undefined,ml:boolean){if(!role)return "—";if(!ml)return role;return ({Administrator:"അഡ്മിനിസ്ട്രേറ്റർ",Manager:"മാനേജർ",Operator:"ഓപ്പറേറ്റർ",Viewer:"വ്യൂവർ"} as Record<string,string>)[role]||role;}
export function Sidebar(){
  const {t,lang}=useI18n();const {user,logout}=useAuth();const navigate=useNavigate();
  const [collapsed,setCollapsed]=useState(false);const [tip,setTip]=useState<{text:string;top:number}|null>(null);
  const ml=lang==="ml";
  const handleLogout=async()=>{await logout();navigate("/login")};
  const sectionText=(s:string)=>ml?sectionLabel[s]||s:s;
  return <aside className={cn("sidebar",collapsed&&"min")}>
    {/* Navigation */}
    <div className="navscroll" onMouseLeave={()=>setTip(null)}>
      {NAV.map((item,i)=>{
        if(item.sec)return <div key={`sec-${i}`} className="navsec">{collapsed?"":sectionText(item.sec)}</div>;
        const Icon=item.icon!;
        return <NavLink key={item.id} to={item.to!} end={item.to==="/"}
          className={({isActive})=>cn("navit",TINTS[item.id!],isActive&&"on")}
          onMouseEnter={e=>{if(collapsed){const r=e.currentTarget.getBoundingClientRect();setTip({text:t(item.key!),top:r.top+r.height/2})}}}>
          <span className="navit-ic"><Icon className="ic" size={17} strokeWidth={2}/></span>
          {!collapsed&&<b>{t(item.key!)}</b>}
          {!collapsed&&<i className="navit-dot" aria-hidden="true"/>}
        </NavLink>
      })}
    </div>
    {collapsed&&tip&&<div className="sidebar-flyout-tip" style={{top:tip.top}} role="tooltip">{tip.text}</div>}
    {/* User footer */}
    <div className="sb-user">
      <span className="sb-avatar"><span className="av">{user?.initials??"?"}</span><i aria-hidden="true"/></span>
      {!collapsed&&<div className="nm"><b>{user?.fullName??"—"}</b><small>{roleLabel(user?.role,ml)}</small></div>}
      <button className="ibtn sb-logout" onClick={handleLogout} title={t("action_logout")}><LogOut size={16} strokeWidth={2}/></button>
    </div>
    <button className="flap" onClick={()=>setCollapsed(!collapsed)} title={ml?"സൈഡ്ബാർ ചുരുക്കുക":"Collapse sidebar"}><span className="ic"><ChevronRight size={16} strokeWidth={2.4}/></span></button>
  </aside>;
}
