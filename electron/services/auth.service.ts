import crypto from "node:crypto";
import { one, run, scalar } from "../db/connection.js";

interface UserRow { id:number; username:string; full_name:string; password_hash:string; password_salt:string; role:string; is_active:number; is_locked:number; failed_attempts:number; locked_until:string|null; must_change_pwd:number; }
export interface AuthUser { id:number; username:string; fullName:string; role:string; isActive:boolean; mustChangePwd:boolean; initials:string; }
type ActorContext={id:number;username:string;role:string};
let currentActor:ActorContext|null=null; let currentUser:AuthUser|null=null;
const globals=globalThis as typeof globalThis & {__mmsGetActor?:()=>ActorContext|null;__mmsGetUser?:()=>AuthUser|null;__mmsClearActor?:()=>void};
globals.__mmsGetActor=()=>currentActor; globals.__mmsGetUser=()=>currentUser; globals.__mmsClearActor=()=>{currentActor=null;currentUser=null;};
// Hashes of administrator credentials whose plaintext was publicly committed
// to this repository by the old demo seed ("admin123" placeholder and the
// later "Admin@2026" demo reset). An install whose ONLY account is one of
// these must go through initial setup instead of accepting a password that
// anyone who read the source knows. See also migration V035, which flags
// such accounts with must_change_pwd=1 for the multi-user case.
const SEEDED_ADMIN_HASHES=[
  "pbkdf2_sha256$200000$c2FsdC1mb3ItbW1zLWFkbWluLXVzZXI=$dJvtGdhlhx7H/9KuwAZs4U/j/DjiiDA88txKk9SnqTU=", // old placeholder: admin123
  "pbkdf2_sha256$200000$zRLKI0xyc2sYKBzQaWXl6w==$qHO4yvos81/Oah+ECzVbh1ZHPz3rEhRHOJT2criWCPg="  // published demo: Admin@2026
];
function parseStoredHash(stored:string){const p=stored.split("$");if(p.length!==4||p[0]!=="pbkdf2_sha256")return null;const iter=parseInt(p[1],10),salt=Buffer.from(p[2],"base64"),hash=Buffer.from(p[3],"base64");return Number.isFinite(iter)&&iter>0&&salt.length&&hash.length?{iter,salt,hash}:null;}
function verifyPassword(plain:string,stored:string){const p=parseStoredHash(stored);if(!p)return false;try{const d=crypto.pbkdf2Sync(plain,p.salt,p.iter,p.hash.length,"sha256");return d.length===p.hash.length&&crypto.timingSafeEqual(d,p.hash);}catch{return false;}}
/** Verify a plaintext password against a stored pbkdf2 hash. Exported for the
 *  uninstall guard, which must verify an admin password WITHOUT a logged-in
 *  session (the app runs headless-ish with just a verify window). */
export function verifyStoredPassword(plain:string,stored:string){return verifyPassword(plain,stored);}
function makeInitials(name:string){if(!name)return"?";const p=name.trim().split(/\s+/);return p.length===1?p[0].substring(0,1).toUpperCase():(p[0][0]+p[p.length-1][0]).toUpperCase();}
function seededAdmin(): UserRow|undefined { return one<UserRow>(`SELECT id,username,full_name,password_hash,password_salt,role,is_active,is_locked,failed_attempts,locked_until,must_change_pwd FROM users WHERE id=1 AND username='admin' AND password_hash IN (${SEEDED_ADMIN_HASHES.map(()=>"?").join(",")})`,SEEDED_ADMIN_HASHES); }
export function validatePassword(password:string){if(!password||password.length<8)throw new Error("Password must be at least 8 characters");if(!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/\d/.test(password)||!/[^A-Za-z0-9]/.test(password))throw new Error("Password must include uppercase, lowercase, digit, and special character");}
function hashPassword(password:string){validatePassword(password);const salt=crypto.randomBytes(16),iter=200000,hash=crypto.pbkdf2Sync(password,salt,iter,32,"sha256");return {stored:`pbkdf2_sha256$${iter}$${salt.toString("base64")}$${hash.toString("base64")}`,salt:salt.toString("base64")};}
/** Shared password-hashing helper used by both auth.service and users.service to keep a single source of truth. */
export function hashPasswordForStorage(password:string){return hashPassword(password);}
export function needsInitialSetup(){
  const count=Number(scalar<number>("SELECT COUNT(*) FROM users")||0);
  return count===0 || (!!seededAdmin() && count===1);
}
export function createInitialAdministrator(username:string,fullName:string,password:string):AuthUser{
 if(!needsInitialSetup())throw new Error("Initial setup has already been completed");
 username=String(username||"").trim(); fullName=String(fullName||"").trim(); if(!/^[A-Za-z0-9._-]{3,32}$/.test(username))throw new Error("Username must be 3-32 characters and contain only letters, numbers, dot, underscore or hyphen"); if(!fullName)throw new Error("Full name is required");
 const {stored,salt}=hashPassword(password); const placeholder=seededAdmin();
 const r=placeholder
   ? run("UPDATE users SET username=?,full_name=?,password_hash=?,password_salt=?,role='Administrator',is_active=1,is_locked=0,failed_attempts=0,locked_until=NULL,must_change_pwd=0,updated_at=datetime('now') WHERE id=?",[username,fullName,stored,salt,placeholder.id])
   : run("INSERT INTO users (username,full_name,password_hash,password_salt,role,is_active,is_locked,failed_attempts,must_change_pwd) VALUES (?,?,?,?, 'Administrator',1,0,0,0)",[username,fullName,stored,salt]);
 const id=placeholder?.id??r.id; const user:AuthUser={id,username,fullName,role:"Administrator",isActive:true,mustChangePwd:false,initials:makeInitials(fullName)}; currentActor={id:user.id,username:user.username,role:user.role}; currentUser=user; return user;
}
export function login(username:string,password:string):AuthUser{
 if(!username||!password)throw new Error("Username and password are required");
 if(needsInitialSetup())throw new Error("Initial account setup is required");
 const user=one<UserRow>(`SELECT id,username,full_name,password_hash,password_salt,role,is_active,is_locked,failed_attempts,locked_until,must_change_pwd FROM users WHERE username = ?`,[username.trim()]);
 if(!user)throw new Error("Invalid username or password"); if(!user.is_active)throw new Error("Account is inactive — contact administrator");
 if(user.is_locked){if(!user.locked_until)throw new Error("Account is locked — contact administrator");const until=new Date(user.locked_until.replace(" ","T")+ (user.locked_until.includes("Z")?"":"Z"));if(!Number.isNaN(until.getTime())&&until>new Date())throw new Error("Too many failed login attempts — try again later");run("UPDATE users SET is_locked=0,locked_until=NULL,failed_attempts=0 WHERE id=?",[user.id]);}
 if(!verifyPassword(password,user.password_hash)){const attempts=(user.failed_attempts||0)+1;if(attempts>=5)run("UPDATE users SET failed_attempts=?,is_locked=1,locked_until=datetime('now','+15 minutes'),updated_at=datetime('now') WHERE id=?",[attempts,user.id]);else run("UPDATE users SET failed_attempts=?,updated_at=datetime('now') WHERE id=?",[attempts,user.id]);throw new Error("Invalid username or password");}
 run("UPDATE users SET last_login_at=datetime('now'),failed_attempts=0,is_locked=0,locked_until=NULL,updated_at=datetime('now') WHERE id=?",[user.id]);
 currentActor={id:user.id,username:user.username,role:user.role}; currentUser={id:user.id,username:user.username,fullName:user.full_name,role:user.role,isActive:!!user.is_active,mustChangePwd:!!user.must_change_pwd,initials:makeInitials(user.full_name)}; return currentUser;
}
export function changePassword(userId:number,newPassword:string){if(!currentActor)throw new Error("Authentication is required");if(!Number.isInteger(userId)||userId<=0)throw new Error("Invalid user");if(currentActor.id!==userId&&currentActor.role!=="Administrator")throw new Error("You can only change your own password");const target=one<{id:number;is_active:number}>("SELECT id,is_active FROM users WHERE id=?",[userId]);if(!target)throw new Error("User not found");if(!target.is_active)throw new Error("Cannot change the password of an inactive user");const {stored,salt}=hashPassword(newPassword);run("UPDATE users SET password_hash=?,password_salt=?,must_change_pwd=0,failed_attempts=0,is_locked=0,locked_until=NULL,updated_at=datetime('now') WHERE id=?",[stored,salt,userId]);}
/** Re-authentication for sensitive (secure) actions: verifies the PASSWORD of
 *  the CURRENTLY logged-in administrator against the stored PBKDF2 hash.
 *  Used before cancellations, disbursements, resignations etc. so a walked-away
 *  workstation cannot be abused. */
export function verifyCurrentActorPassword(password:string):{id:number;username:string;role:string}{
 if(!currentActor)throw new Error("Authentication is required");
 if(currentActor.role!=="Administrator")throw new Error("Administrator permission is required for this operation");
 if(!password)throw new Error("Administrator password is required");
 const user=one<UserRow>("SELECT id,username,full_name,password_hash,password_salt,role,is_active,is_locked FROM users WHERE id=?",[currentActor.id]);
 if(!user)throw new Error("User not found");
 if(!user.is_active)throw new Error("Account is inactive — contact administrator");
 if(user.is_locked)throw new Error("Account is locked — contact administrator");
 if(!verifyPassword(password,user.password_hash))throw new Error("Incorrect administrator password");
 return {id:user.id,username:user.username,role:user.role};
}
