import { NavLink, useNavigate } from "react-router-dom";
import { LogOut, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { NAV, TINTS, SECTION_LABELS, isSection } from "./navItems";

function roleLabel(role:string|undefined,ml:boolean){if(!role)return "—";if(!ml)return role;return ({Administrator:"അഡ്മിനിസ്ട്രേറ്റർ",Manager:"മാനേജർ",Operator:"ഓപ്പറേറ്റർ",Viewer:"വ്യൂവർ"} as Record<string,string>)[role]||role;}
export function Sidebar(){
  const {t,lang}=useI18n();const {user,logout}=useAuth();const navigate=useNavigate();
  const [collapsed,setCollapsed]=useState(false);const [tip,setTip]=useState<{text:string;top:number}|null>(null);
  const ml=lang==="ml";
  const handleLogout=async()=>{await logout();navigate("/login")};
  const sectionText=(s:string)=>ml?SECTION_LABELS[s]||s:s;
  return <aside className={cn("sidebar",collapsed&&"min")}>
    {/* Navigation */}
    <div className="navscroll" onMouseLeave={()=>setTip(null)}>
      {NAV.map((item,i)=>{
        if(isSection(item))return <div key={`sec-${i}`} className="navsec">{collapsed?"":sectionText(item.sec)}</div>;
        const Icon=item.icon!;
        return <NavLink key={item.id} to={item.to} end={item.to==="/"}
          className={({isActive})=>cn("navit",TINTS[item.id],isActive&&"on")}
          onMouseEnter={e=>{if(collapsed){const r=e.currentTarget.getBoundingClientRect();setTip({text:t(item.key),top:r.top+r.height/2})}}}>
          <span className="navit-ic"><Icon className="ic" size={17} strokeWidth={2}/></span>
          {!collapsed&&<b>{t(item.key)}</b>}
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
