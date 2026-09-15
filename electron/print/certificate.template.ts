import { esc, getAnekMalayalamCss } from './utils.js';
import { getDB } from '../db/connection.js';
import { istDateTimeDm } from '../services/ist-date.js';

interface CertData {
  type: string;
  certificate_number: string;
  issued_to: string;
  issued_date: string;
  issued_by: number;
  member_id: number | null;
  family_id: number | null;
  marriage_id: number | null;
  death_id: number | null;
  notes: string;
  // Anti-forgery:
  verification_code?: string;
  reprint_count?: number;
  // Enriched fields (fetched from related tables):
  mahallu_name?: string;
  mahallu_address?: string;
  mahallu_phone?: string;
  // Registration numbers (printed on certificates ONLY when filled):
  smf_reg_no?: string;
  wakf_reg_no?: string;
  society_reg_no?: string;
  // Mahallu jurisdiction (death certificate):
  village?: string;
  panchayath?: string;
  taluk?: string;
  district?: string;
  pincode?: string;
  state?: string;
  // Mahallu secretary (death certificate signature block):
  secretary_name?: string;
  secretary_phone?: string;
  // Member fields (for membership cert):
  member_code?: string;
  member_name?: string;
  member_father?: string;
  member_dob?: string;
  member_blood_group?: string;
  member_occupation?: string;
  member_mobile?: string;
  // Family fields (for residence cert):
  family_number?: string;
  house_name?: string;
  house_number?: string;
  ward?: string;
  area?: string;
  address?: string;
  family_pincode?: string;
  phone?: string;
  // Marriage fields (for marriage + NOC cert):
  marriage_number?: string;
  bride_name?: string;
  bride_father?: string;
  bride_address?: string;
  groom_name?: string;
  groom_father?: string;
  groom_address?: string;
  mahar?: string;
  nikah_date?: string;
  registration_date?: string;
  place?: string;
  witness1?: string;
  witness2?: string;
  witness3?: string;
  witness4?: string;
  // Death fields (for death cert):
  death_number?: string;
  deceased_name?: string;
  father_name?: string;
  gender?: string;
  age?: number | null;
  date_of_death?: string;
  place_of_death?: string;
  burial_date?: string;
  cause_of_death?: string;
  burial_place?: string;
  death_address?: string;
  death_registration_date?: string;
}

interface ActiveSettings {
  language: 'en' | 'ml';
  mahalluName: string;
  mahalluAddress: string;
  mahalluPhone: string;
  smfRegNo: string;
  wakfRegNo: string;
  societyRegNo: string;
  village: string;
  panchayath: string;
  taluk: string;
  district: string;
  pincode: string;
  state: string;
}

function activeSettings(): ActiveSettings {
  try {
    const row = getDB().prepare('SELECT language, mahallu_name, address, phone, affiliation_number, wakf_reg_no, society_reg_no, village, panchayath, taluk, district, pincode, state FROM settings WHERE id = 1').get() as any;
    const trim = (v: any) => String(v ?? '').trim();
    return {
      language: row?.language === 'ml' ? 'ml' : 'en',
      mahalluName: trim(row?.mahallu_name) || 'Minz Mahallu',
      mahalluAddress: trim(row?.address),
      mahalluPhone: trim(row?.phone),
      smfRegNo: trim(row?.affiliation_number),
      wakfRegNo: trim(row?.wakf_reg_no),
      societyRegNo: trim(row?.society_reg_no),
      village: trim(row?.village),
      panchayath: trim(row?.panchayath),
      taluk: trim(row?.taluk),
      district: trim(row?.district),
      pincode: trim(row?.pincode),
      state: trim(row?.state),
    };
  } catch {
    return { language: 'en', mahalluName: 'Minz Mahallu', mahalluAddress: '', mahalluPhone: '', smfRegNo: '', wakfRegNo: '', societyRegNo: '', village: '', panchayath: '', taluk: '', district: '', pincode: '', state: '' };
  }
}

/** Active mahallu secretary (from the committee register) for the death
 *  certificate signature block. Falls back to the mahallu phone number. */
function activeSecretary(): { name: string; phone: string } {
  try {
    const row = getDB().prepare(
      `SELECT name, phone FROM committee_members
        WHERE archive_state = 0 AND status = 'Active' AND position LIKE '%Secretary%'
        ORDER BY term_end DESC, id DESC LIMIT 1`
    ).get() as any;
    return { name: String(row?.name || '').trim(), phone: String(row?.phone || '').trim() };
  } catch {
    return { name: '', phone: '' };
  }
}

function fmtDate(d: string | null | undefined, ml: boolean): string {
  if (!d) return '—';
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return String(d);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  } catch { return String(d); }
}

/** Enrich a bare certificate row with related member/family/marriage/death data. */
function enrichCertificate(cert: any): CertData {
  const settings = activeSettings();
  const base: CertData = {
    type: String(cert?.type || 'certificate').toLowerCase(),
    certificate_number: cert?.certificate_number || cert?.certificateNo || '—',
    issued_to: cert?.issued_to || cert?.member_name || cert?.name || '—',
    issued_date: cert?.issued_date || '',
    issued_by: cert?.issued_by || 0,
    member_id: cert?.member_id || null,
    family_id: cert?.family_id || null,
    marriage_id: cert?.marriage_id || null,
    death_id: cert?.death_id || null,
    notes: cert?.notes || '',
    // Anti-forgery fields MUST survive enrichment — dropping verification_code
    // here silently removed the whole verify box (QR + code) from every
    // certificate print, even though the QR SVG was passed in.
    verification_code: cert?.verification_code || '',
    reprint_count: cert?.reprint_count || 0,
    mahallu_name: settings.mahalluName,
    mahallu_address: settings.mahalluAddress,
    mahallu_phone: settings.mahalluPhone,
    smf_reg_no: settings.smfRegNo,
    wakf_reg_no: settings.wakfRegNo,
    society_reg_no: settings.societyRegNo,
    village: settings.village,
    panchayath: settings.panchayath,
    taluk: settings.taluk,
    district: settings.district,
    pincode: settings.pincode,
    state: settings.state,
  };

  try {
    // Fetch related member data
    if (base.member_id) {
      const m = getDB().prepare('SELECT member_code, name, date_of_birth, blood_group, occupation, mobile, family_id FROM members WHERE id = ?').get(base.member_id) as any;
      if (m) {
        base.member_code = m.member_code;
        base.member_name = m.name;
        base.member_dob = m.date_of_birth;
        base.member_blood_group = m.blood_group;
        base.member_occupation = m.occupation;
        base.member_mobile = m.mobile;
        if (!base.family_id) base.family_id = m.family_id;
      }
    }

    // Fetch related family data
    if (base.family_id) {
      const f = getDB().prepare('SELECT family_number, house_name, house_number, ward, area, address, pincode, phone FROM families WHERE id = ?').get(base.family_id) as any;
      if (f) {
        base.family_number = f.family_number;
        base.house_name = f.house_name;
        base.house_number = f.house_number;
        base.ward = f.ward;
        base.area = f.area;
        base.address = f.address;
        base.family_pincode = f.pincode;
        base.phone = f.phone;
      }
    }

    // Fetch related marriage data
    if (base.marriage_id) {
      const m = getDB().prepare('SELECT marriage_number, bride_name, bride_father, bride_address, groom_name, groom_father, groom_address, mahar, nikah_date, registration_date, place, witness1, witness2, witness3, witness4 FROM marriages WHERE id = ?').get(base.marriage_id) as any;
      if (m) {
        base.marriage_number = m.marriage_number;
        base.bride_name = m.bride_name;
        base.bride_father = m.bride_father;
        base.bride_address = m.bride_address;
        base.groom_name = m.groom_name;
        base.groom_father = m.groom_father;
        base.groom_address = m.groom_address;
        base.mahar = m.mahar;
        base.nikah_date = m.nikah_date;
        base.registration_date = m.registration_date;
        base.place = m.place;
        base.witness1 = m.witness1;
        base.witness2 = m.witness2;
        base.witness3 = m.witness3;
        base.witness4 = m.witness4;
      }
    } else if (base.type === 'marriage' || base.type === 'noc') {
      // Try to find marriage by issued_to name (fallback if marriage_id is null)
      const names = (base.issued_to || '').split(' & ');
      if (names.length >= 2) {
        const m = getDB().prepare('SELECT * FROM marriages WHERE bride_name = ? AND groom_name = ? ORDER BY id DESC LIMIT 1').get(names[0], names[1]) as any;
        if (m) {
          base.marriage_number = m.marriage_number;
          base.bride_name = m.bride_name;
          base.bride_father = m.bride_father;
          base.bride_address = m.bride_address;
          base.groom_name = m.groom_name;
          base.groom_father = m.groom_father;
          base.groom_address = m.groom_address;
          base.mahar = m.mahar;
          base.nikah_date = m.nikah_date;
          base.registration_date = m.registration_date;
          base.place = m.place;
          base.witness1 = m.witness1;
          base.witness2 = m.witness2;
          base.witness3 = m.witness3;
          base.witness4 = m.witness4;
        }
      }
    }

    // Fetch related death data
    if (base.death_id) {
      const d = getDB().prepare('SELECT death_number, deceased_name, father_name, gender, age, date_of_death, place_of_death, burial_date, cause_of_death, burial_place, address, registration_date, created_at FROM deaths WHERE id = ?').get(base.death_id) as any;
      if (d) {
        base.death_number = d.death_number;
        base.deceased_name = d.deceased_name;
        base.father_name = d.father_name;
        base.gender = d.gender;
        base.age = d.age ?? null;
        base.date_of_death = d.date_of_death;
        base.place_of_death = d.place_of_death;
        base.burial_date = d.burial_date;
        base.cause_of_death = d.cause_of_death;
        base.burial_place = d.burial_place;
        base.death_address = d.address;
        base.death_registration_date = d.registration_date || String(d.created_at || '').slice(0, 10);
      }
    } else if (base.type === 'death') {
      // Try to find death record by deceased_name
      const d = getDB().prepare('SELECT id, death_number, deceased_name, father_name, gender, age, date_of_death, place_of_death, burial_date, cause_of_death, burial_place, address, registration_date, created_at, family_id FROM deaths WHERE deceased_name = ? ORDER BY id DESC LIMIT 1').get(base.issued_to) as any;
      if (d) {
        base.death_id = d.id;
        base.death_number = d.death_number;
        base.deceased_name = d.deceased_name;
        base.father_name = d.father_name;
        base.gender = d.gender;
        base.age = d.age ?? null;
        base.date_of_death = d.date_of_death;
        base.place_of_death = d.place_of_death;
        base.burial_date = d.burial_date;
        base.cause_of_death = d.cause_of_death;
        base.burial_place = d.burial_place;
        base.death_address = d.address;
        base.death_registration_date = d.registration_date || String(d.created_at || '').slice(0, 10);
        if (!base.family_id) base.family_id = d.family_id;
      }
    }

    // Death certificate: permanent address falls back to the family address,
    // and the signature block uses the active mahallu secretary.
    if (base.type === 'death') {
      if (!base.death_address && base.family_id) {
        const f = getDB().prepare('SELECT address, area, ward, pincode FROM families WHERE id = ?').get(base.family_id) as any;
        if (f) base.death_address = [f.address, f.area, f.ward].filter(Boolean).join(', ') + (f.pincode ? ` - ${f.pincode}` : '');
      }
      const sec = activeSecretary();
      base.secretary_name = sec.name;
      base.secretary_phone = sec.phone || settings.mahalluPhone;
    }
  } catch (e) {
    // Enrichment is best-effort — if it fails, we still render with what we have.
    console.warn('[certificate] Enrichment failed:', e);
  }

  return base;
}

// ===== Shared CSS (Kerala mahallu certificate styling) =====
function sharedCss(ml: boolean, landscape = false): string {
  const anekCss = getAnekMalayalamCss();
  const pageW = landscape ? '297mm' : '210mm';
  const pageH = landscape ? '210mm' : '297mm';
  // Fixed height (not min-height) so a certificate can NEVER spill onto a
  // second A4 page: overflow is clipped instead of paginated. The 0.3mm
  // shave absorbs Chromium's page-height rounding (1122.5px vs 1123px at
  // 96dpi) which otherwise emits a blank trailing page.
  const boxH = landscape ? '209.7mm' : '296.7mm';
  return `${anekCss}
@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${pageW};height:${boxH};overflow:hidden;background:#fff}
body{font-family:${ml ? '"Anek Malayalam Variable",' : ''}Poppins,"Anek Malayalam Variable","Segoe UI",Arial,sans-serif;color:#1a2b22;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.cert{width:${pageW};height:${boxH};position:relative;padding:${landscape ? '9mm 13mm' : '13mm 15mm'};overflow:hidden}
/* Double border frame */
.frame-outer{position:absolute;inset:6mm;border:1.2mm solid #0e7c5b;border-radius:3mm;pointer-events:none}
.frame-inner{position:absolute;inset:9mm;border:.25mm solid #9fcfbc;border-radius:2mm;pointer-events:none}
/* Corner ornaments */
.corner{position:absolute;width:16mm;height:16mm;pointer-events:none}
.corner svg{width:100%;height:100%}
.corner.tl{left:7mm;top:7mm}
.corner.tr{right:7mm;top:7mm;transform:scaleX(-1)}
.corner.bl{left:7mm;bottom:7mm;transform:scaleY(-1)}
.corner.br{right:7mm;bottom:7mm;transform:scale(-1,-1)}
/* Anti-forgery: security code — one SMALL, unobtrusive line pinned to the
   BOTTOM of the page (office request): below the signature zone, above the
   page edge, centered. Absolute positioning keeps it out of the document
   flow on every certificate type — including the landscape death
   certificate, where it used to compete with the SMF fields for space. */
.verify-box{position:absolute;left:16mm;right:16mm;bottom:10.5mm;text-align:center;z-index:40}
.verify-copy{display:block}
.verify-label{font-size:6pt;letter-spacing:.8px;color:#8ba096;text-transform:uppercase}
.verify-code{display:inline;font-family:'Courier New',monospace;font-weight:700;font-size:8pt;letter-spacing:2px;color:#4f6a5d;margin:0 2.5mm}
.verify-hint{display:inline;font-size:6pt;color:#8ba096;line-height:1.3}
.reprint-note{position:fixed;left:14mm;bottom:8mm;font-size:7.5pt;color:#7d8f86;letter-spacing:.4px;pointer-events:none;z-index:50}
.reprint-note b{color:#a33a3a;font-weight:700}
/* Header: 3-column grid (spacer | centered name block | reg-no stack).
   The fixed side columns guarantee the mahallu name stays dead-center on the
   page and can NEVER slide under the reg-number boxes, no matter how long
   the mahallu name or the registration numbers are. */
.hdr{text-align:center;position:relative;z-index:1;padding-top:2mm;display:grid;grid-template-columns:40mm 1fr 40mm;column-gap:3mm;align-items:start}
.hdr-main{grid-column:2;text-align:center;min-width:0}
.mahallu-name{font-size:16pt;font-weight:700;color:#0e7c5b;letter-spacing:.3px;line-height:1.25}
.mahallu-addr{font-size:8.5pt;color:#5f7268;margin-top:1mm;line-height:1.3}
.cert-title{font-size:17pt;font-weight:700;color:#1a2b22;letter-spacing:1px;text-transform:uppercase;text-align:center;margin:4mm 0 1mm;padding:1.6mm 0;border-top:.4mm solid #0e7c5b;border-bottom:.4mm solid #0e7c5b}
.cert-subtitle{font-size:8.5pt;color:#5f7268;font-style:italic;text-align:center;margin-bottom:3mm}
/* Meta box (cert no, date) */
.meta-row{display:flex;justify-content:space-between;margin-bottom:3mm;padding:1.6mm 4mm;background:#f0f7f3;border-radius:2mm;border:.2mm solid #c9e0d4}
.meta-row .item{font-size:9pt;color:#5f7268}
.meta-row .item b{color:#1a2b22;font-weight:600}
/* Detail fields */
.fields{margin:2mm 0}
.field-row{display:flex;align-items:flex-start;gap:3mm;padding:1.8mm 0;border-bottom:.15mm solid #e6ede7}
.field-label{width:45mm;font-size:9.5pt;color:#5f7268;font-weight:500;flex:none}
.field-value{flex:1;font-size:10.5pt;color:#1a2b22;font-weight:600}
.field-value .sub{display:block;font-size:8.5pt;font-weight:400;color:#64736d;margin-top:.5mm}
/* Witness grid */
.witness-grid{display:grid;grid-template-columns:1fr 1fr;gap:3mm 6mm;margin:4mm 0}
.witness-item{padding:2mm 3mm;border:.2mm solid #c9e0d4;border-radius:2mm;background:#f8faf8}
.witness-item .lbl{font-size:8pt;color:#8ba096;font-weight:600;letter-spacing:.05em}
.witness-item .nm{font-size:10pt;color:#1a2b22;font-weight:600;margin-top:.5mm}
/* Body text */
.body-text{font-size:10.5pt;line-height:1.7;color:#2d3d35;text-align:justify;margin:3mm 0}
.body-text b{color:#0e7c5b}
/* Signatures */
.sig-area{position:absolute;left:16mm;right:16mm;bottom:18mm;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8mm}
.sig-box{text-align:center}
.sig-line{border-top:.3mm solid #5f7268;margin:14mm 6mm 1mm}
.sig-label{font-size:8.5pt;color:#5f7268;font-weight:600}
.sig-sub{font-size:7.5pt;color:#8ba096;margin-top:.5mm}
/* Seal */
.seal{position:absolute;right:22mm;bottom:14mm;width:28mm;height:28mm;border:1.5px solid #0e7c5b;border-radius:50%;display:grid;place-items:center;text-align:center;font-size:7pt;color:#0e7c5b;font-weight:600;opacity:.3;transform:rotate(-12deg)}
/* Footer */
.cert-footer{position:absolute;left:16mm;right:16mm;bottom:6mm;text-align:center;font-size:7.5pt;color:#8ba096}
/* ===== Registration number stack (all certificates) — shown ONLY when filled.
   Lives in the header's right grid column (top-right corner of the page). ===== */
.reg-stack{grid-column:3;justify-self:end;align-self:start;display:flex;flex-direction:column;gap:1.2mm;align-items:flex-end;text-align:left}
.reg-box{border:.25mm solid #9fcfbc;border-radius:1mm;padding:.7mm 2.2mm;font-size:7.5pt;color:#5f7268;background:#f6faf8;max-width:40mm;line-height:1.35}
.reg-box b{color:#1a2b22;font-weight:600}
/* ===== Death certificate — our design, official SMF register texts/format.
   Tightened vertical rhythm: the SMF field set + the verify box must ALWAYS
   fit ONE A4 landscape sheet (209.7mm usable). ===== */
.dc-recog{margin-top:1.4mm;font-size:8pt;line-height:1.4;font-style:italic;color:#5f7268}
.dc-statement{font-size:10pt;line-height:1.55;margin:2mm 1mm 0;color:#2d3d35;text-align:justify}
.dc-statement b{color:#0e7c5b}
.dc-cols{display:grid;gap:0 9mm}
.dc-cols.c3{grid-template-columns:1.1fr 1.1fr 1fr}
.dc-cols.c2{grid-template-columns:1fr 1fr}
/* Gridded cells stack the label ABOVE the value so long labels
   (e.g. Corporation / Municipality / Panchayat) wrap without
   pushing the value out of alignment with sibling columns. */
.dc-cols .field-row{flex-direction:column;align-items:flex-start;gap:.3mm;padding:1mm 0}
.dc-cols .field-label{width:100%;flex:none;font-size:7.5pt;line-height:1.3;color:#8ba096}
.dc-cols .field-value{width:100%}
.dc .field-label{width:auto;flex:none}
.dc .field-row{padding:1.2mm 0}
.dc .field-value{font-size:9.5pt}
.dc-sign{position:absolute;right:20mm;bottom:20mm;width:80mm;text-align:center}
.dc-sign .sig-line{border-top:.3mm solid #5f7268;margin:10mm 6mm 1mm}
.dc .fields{margin:1mm 0}`;
}

// Corner SVG ornament
const CORNER_SVG = `<svg viewBox="0 0 40 40" fill="none" stroke="#0e7c5b" stroke-width="1.2"><path d="M0 8 L0 0 L8 0"/><path d="M0 16 Q0 8 8 8 Q16 8 16 0"/><circle cx="4" cy="4" r="1.5" fill="#0e7c5b" stroke="none"/></svg>`;

function buildRegStack(c: CertData, ml: boolean): string {
  // Reg numbers print ONLY when filled in Settings — an unfilled box is
  // omitted entirely rather than shown blank.
  const L = ml ? { smf: 'SMF രജി. നമ്പർ', wakf: 'വഖഫ് രജി. നമ്പർ', society: 'സൊസൈറ്റി രജി. നമ്പർ' }
               : { smf: 'SMF Reg. No.', wakf: 'Wakaf Reg. No.', society: 'Society Reg. No.' };
  const boxes: string[] = [];
  if (c.smf_reg_no) boxes.push(`<div class="reg-box">${L.smf}: <b>${esc(c.smf_reg_no)}</b></div>`);
  if (c.wakf_reg_no) boxes.push(`<div class="reg-box">${L.wakf}: <b>${esc(c.wakf_reg_no)}</b></div>`);
  if (c.society_reg_no) boxes.push(`<div class="reg-box">${L.society}: <b>${esc(c.society_reg_no)}</b></div>`);
  return boxes.length ? `<div class="reg-stack">${boxes.join('')}</div>` : '';
}

function buildHeader(c: CertData, ml: boolean): string {
  const addr = [c.mahallu_address, c.mahallu_phone].filter(Boolean).join(' · ');
  return `<div class="hdr">
    <div class="hdr-main">
      <div class="mahallu-name">${esc(c.mahallu_name || 'Minz Mahallu')}</div>
      ${addr ? `<div class="mahallu-addr">${esc(addr)}</div>` : ''}
    </div>
    ${buildRegStack(c, ml)}
  </div>`;
}

function buildMetaRow(c: CertData, ml: boolean): string {
  const L = ml ? {
    certNo: 'സർട്ടിഫിക്കറ്റ് നമ്പർ', date: 'തീയതി', regNo: 'രജിസ്ട്രേഷൻ നമ്പർ',
  } : {
    certNo: 'Certificate No.', date: 'Date of Issue', regNo: 'Reg. No.',
  };
  return `<div class="meta-row">
    <div class="item">${L.certNo}: <b>${esc(c.certificate_number)}</b></div>
    <div class="item">${L.date}: <b>${fmtDate(c.issued_date, ml)}</b></div>
    ${c.marriage_number ? `<div class="item">${L.regNo}: <b>${esc(c.marriage_number)}</b></div>` : ''}
    ${c.death_number ? `<div class="item">${L.regNo}: <b>${esc(c.death_number)}</b></div>` : ''}
  </div>`;
}

function buildSignatures(ml: boolean): string {
  const L = ml ? {
    president: 'പ്രസിഡന്റ്', secretary: 'സെക്രട്ടറി', imam: 'ഇമാം / ഖാസി',
    committee: 'മഹല്ല് കമ്മിറ്റി', mahallu: 'മഹല്ല് മാനേജ്മെന്റ് കമ്മിറ്റി',
  } : {
    president: 'President', secretary: 'Secretary', imam: 'Imam / Qazi',
    committee: 'Mahallu Committee', mahallu: 'Mahallu Management Committee',
  };
  return `<div class="sig-area">
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${L.president}</div><div class="sig-sub">${L.committee}</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${L.secretary}</div><div class="sig-sub">${L.committee}</div></div>
    <div class="sig-box"><div class="sig-line"></div><div class="sig-label">${L.imam}</div><div class="sig-sub">${L.mahallu}</div></div>
  </div>
  <div class="seal">${esc('MAHALLU\\nSEAL')}</div>
  <div class="cert-footer">${fmtDate(new Date().toISOString(), ml)}</div>`;
}

// ===== Certificate-type-specific builders =====

function buildMarriageCert(c: CertData, ml: boolean): string {
  const L = ml ? {
    title: 'നികാഹ് സർട്ടിഫിക്കറ്റ്', subtitle: 'മഹല്ല് നികാഹ് രജിസ്റ്ററിൽ രേഖപ്പെടുത്തിയത്',
    groom: 'വരന്റെ പേര്', groomFather: 'വരന്റെ പിതാവ്', groomAddr: 'വരന്റെ വിലാസം',
    bride: 'വധുവിന്റെ പേര്', brideFather: 'വധുവിന്റെ പിതാവ്', brideAddr: 'വധുവിന്റെ വിലാസം',
    mahar: 'മഹർ', nikahDate: 'നികാഹ് തീയതി', place: 'സ്ഥലം', regDate: 'രജിസ്ട്രേഷൻ തീയതി',
    witnesses: 'സാക്ഷികൾ', witness: 'സാക്ഷി',
    certifyText: 'മേല്പറഞ്ഞ നികാഹ് മഹല്ല് രജിസ്റ്ററിൽ രേഖപ്പെടുത്തിയതായി സാക്ഷ്യപ്പെടുത്തുന്നു.',
  } : {
    title: 'MARRIAGE CERTIFICATE', subtitle: 'Registered in the Mahallu Marriage Register',
    groom: 'Name of Bridegroom', groomFather: 'Son of', groomAddr: 'Address',
    bride: 'Name of Bride', brideFather: 'Daughter of', brideAddr: 'Address',
    mahar: 'Mahr', nikahDate: 'Date of Nikah', place: 'Place of Nikah', regDate: 'Registration Date',
    witnesses: 'Witnesses', witness: 'Witness',
    certifyText: 'This is to certify that the above marriage is recorded in the Mahallu register.',
  };
  const witnesses = [c.witness1, c.witness2, c.witness3, c.witness4].filter(Boolean);
  return `<main class="cert">
  <div class="frame-outer"></div><div class="frame-inner"></div>
  <div class="corner tl">${CORNER_SVG}</div><div class="corner tr">${CORNER_SVG}</div><div class="corner bl">${CORNER_SVG}</div><div class="corner br">${CORNER_SVG}</div>
  ${buildHeader(c, ml)}
  <div class="cert-title">${L.title}</div>
  <div class="cert-subtitle">${L.subtitle}</div>
  ${buildMetaRow(c, ml)}
  <div class="fields">
    <div class="field-row"><div class="field-label">${L.groom}</div><div class="field-value">${esc(c.groom_name || '—')}<span class="sub">${L.groomFather}: ${esc(c.groom_father || '—')}</span><span class="sub">${L.groomAddr}: ${esc(c.groom_address || '—')}</span></div></div>
    <div class="field-row"><div class="field-label">${L.bride}</div><div class="field-value">${esc(c.bride_name || '—')}<span class="sub">${L.brideFather}: ${esc(c.bride_father || '—')}</span><span class="sub">${L.brideAddr}: ${esc(c.bride_address || '—')}</span></div></div>
    <div class="field-row"><div class="field-label">${L.mahar}</div><div class="field-value">${esc(c.mahar || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.nikahDate}</div><div class="field-value">${fmtDate(c.nikah_date, ml)}</div></div>
    <div class="field-row"><div class="field-label">${L.place}</div><div class="field-value">${esc(c.place || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.regDate}</div><div class="field-value">${fmtDate(c.registration_date, ml)}</div></div>
  </div>
  ${witnesses.length ? `<div class="witness-grid"><div class="lbl" style="grid-column:1/-1;font-size:8pt;color:#8ba096;font-weight:600;letter-spacing:.05em;margin-bottom:1mm">${L.witnesses}</div>${witnesses.map((w, i) => `<div class="witness-item"><div class="lbl">${L.witness} ${i + 1}</div><div class="nm">${esc(w || '—')}</div></div>`).join('')}</div>` : ''}
  <div class="body-text" style="margin-top:4mm">${L.certifyText}</div>
  ${buildSignatures(ml)}
</main>`;
}

function buildDeathCert(c: CertData, ml: boolean): string {
  // Our branded certificate design carrying the official SMF death register
  // texts and field structure (Village/Panchayath/Taluk … Secretary/Sign).
  const L = ml ? {
    subtitle: 'മഹല്ല് മരണ രജിസ്റ്ററിൽ രേഖപ്പെടുത്തിയത്',
    recog1: 'അംഗീകാരം: SAMASTHA KERALA SUNNI MAHALLU FEDERATION (SMF)',
    recog2: 'സംസ്ഥാന കമ്മിറ്റി : സമസ്തലയം, ചേളാരി',
    title: 'മരണ സർട്ടിഫിക്കറ്റ്',
    statement: 'മരണത്തെക്കുറിച്ചുള്ള താഴെ പറയുന്ന വിവരങ്ങൾ യഥാർത്ഥ മരണ രേഖയിൽ നിന്ന് എടുത്തതാണെന്ന് സാക്ഷ്യപ്പെടുത്തുന്നു. അത് രജിസ്റ്റർ ചെയ്തിരിക്കുന്നത്',
    mahalluSuffix: '(മഹല്ല്) എന്നതിനു വേണ്ടിയുള്ള രജിസ്റ്ററാണ്',
    village: 'വില്ലേജ്', panchayath: 'കോർപ്പറേഷൻ / മുനിസിപ്പാലിറ്റി / പഞ്ചായത്ത്', taluk: 'താലൂക്ക്', district: 'ജില്ല',
    pincode: 'പിൻകോഡ്', state: 'സംസ്ഥാനം',
    name: 'പേര്', sex: 'ലിംഗം', age: 'വയസ്സ്',
    kin: 'പിതാവിന്റെ / മാതാവിന്റെ / ഭർത്താവിന്റെ / ഭാര്യയുടെ പേര്',
    address: 'മൃതന്റെ സ്ഥിര വിലാസം',
    dod: 'മരണ തീയതി', pod: 'മരണ സ്ഥലം',
    regNo: 'രജിസ്ട്രേഷൻ നമ്പർ', regDate: 'രജിസ്ട്രേഷൻ തീയതി',
    secretary: 'മഹല്ല് സെക്രട്ടറി',
    male: 'പുരുഷൻ', female: 'സ്ത്രീ',
  } : {
    subtitle: 'Registered in the Mahallu Death Register',
    recog1: 'Recognized by: SAMASTHA KERALA SUNNI MAHALLU FEDERATION (SMF)',
    recog2: 'STATE COMMITTEE : Samasthalayam, Chelari',
    title: 'DEATH CERTIFICATE',
    statement: 'This is to Certify that the following information has been taken from the original record of death which is the register for',
    mahalluSuffix: '(Mahallu)',
    village: 'Village', panchayath: 'Corporation / Municipality / Panchayat', taluk: 'Taluk', district: 'District',
    pincode: 'Pincode', state: 'State',
    name: 'Name', sex: 'Sex', age: 'Age',
    kin: 'Name of Father / Mother / Husband / Wife',
    address: 'Permanent address of deceased',
    dod: 'Date of death', pod: 'Place of death',
    regNo: 'Registration No.', regDate: 'Date of Registration',
    secretary: 'Mahallu Secretary',
    male: 'Male', female: 'Female',
  };
  const sex = c.gender === 'Male' ? L.male : c.gender === 'Female' ? L.female : (c.gender || '');
  const ageVal = c.age != null && String(c.age) !== '' ? String(c.age) : '';
  const fr = (label: string, value: string | undefined): string =>
    `<div class="field-row"><div class="field-label">${label}</div><div class="field-value">${esc(value || '—')}</div></div>`;
  // Mahallu jurisdiction rows print only when configured in Settings.
  const juris1 = [c.village, c.panchayath, c.taluk].some(Boolean);
  const juris2 = [c.district, c.pincode, c.state].some(Boolean);
  const addr = [c.mahallu_address, c.mahallu_phone].filter(Boolean).join(' · ');
  const secSub = [c.secretary_name, c.secretary_phone].filter(Boolean).map(v => esc(v)).join(' · ');
  return `<main class="cert dc">
  <div class="frame-outer"></div><div class="frame-inner"></div>
  <div class="corner tl">${CORNER_SVG}</div><div class="corner tr">${CORNER_SVG}</div><div class="corner bl">${CORNER_SVG}</div><div class="corner br">${CORNER_SVG}</div>
  <div class="hdr">
    <div class="hdr-main">
      <div class="mahallu-name">${esc(c.mahallu_name || 'Minz Mahallu')}</div>
      ${addr ? `<div class="mahallu-addr">${esc(addr)}</div>` : ''}
      <div class="dc-recog">${L.recog1}<br>${L.recog2}</div>
    </div>
    ${buildRegStack(c, ml)}
  </div>
  <div class="cert-title">${L.title}</div>
  <div class="cert-subtitle">${L.subtitle}</div>
  ${buildMetaRow(c, ml)}
  <div class="dc-statement">${L.statement} <b>${esc(c.mahallu_name || 'Minz Mahallu')}</b> ${L.mahalluSuffix}</div>
  <div class="fields">
    ${juris1 ? `<div class="dc-cols c3">${fr(L.village, c.village)}${fr(L.panchayath, c.panchayath)}${fr(L.taluk, c.taluk)}</div>` : ''}
    ${juris2 ? `<div class="dc-cols c3">${fr(L.district, c.district)}${fr(L.pincode, c.pincode)}${fr(L.state, c.state)}</div>` : ''}
    <div class="dc-cols c3">${fr(L.name, c.deceased_name || c.issued_to)}${fr(L.sex, sex)}${fr(L.age, ageVal)}</div>
    ${fr(L.kin, c.father_name)}
    ${fr(L.address, c.death_address)}
    <div class="dc-cols c2">${fr(L.dod, fmtDate(c.date_of_death, ml))}${fr(L.pod, c.place_of_death)}</div>
    <div class="dc-cols c2">${fr(L.regNo, c.death_number)}${fr(L.regDate, fmtDate(c.death_registration_date, ml))}</div>
  </div>
  <div class="dc-sign">
    <div class="sig-line"></div>
    <div class="sig-label">${L.secretary}</div>
    ${secSub ? `<div class="sig-sub">${secSub}</div>` : ''}
  </div>
  <div class="cert-footer">${fmtDate(new Date().toISOString(), ml)}</div>
</main>`;
}

function buildMembershipCert(c: CertData, ml: boolean): string {
  const L = ml ? {
    title: 'അംഗത്വ സർട്ടിഫിക്കറ്റ്', subtitle: 'മഹല്ല് അംഗത്വ രജിസ്റ്ററിൽ രേഖപ്പെടുത്തിയത്',
    name: 'അംഗത്തിന്റെ പേര്', memberCode: 'അംഗ നമ്പർ', dob: 'ജനന തീയതി',
    blood: 'രക്ത ഗ്രൂപ്പ്', occupation: 'തൊഴിൽ', mobile: 'മൊബൈൽ',
    familyNo: 'കുടുംബ നമ്പർ', houseName: 'വീട്ടുപേര്', area: 'പ്രദേശം',
    certifyText: 'മേല്പറഞ്ഞ വ്യക്തി ഈ മഹല്ലിലെ രജിസ്റ്റർ ചെയ്ത അംഗമാണെന്ന് സാക്ഷ്യപ്പെടുത്തുന്നു.',
  } : {
    title: 'MEMBERSHIP CERTIFICATE', subtitle: 'Registered in the Mahallu Membership Register',
    name: 'Name of Member', memberCode: 'Member No.', dob: 'Date of Birth',
    blood: 'Blood Group', occupation: 'Occupation', mobile: 'Mobile',
    familyNo: 'Family No.', houseName: 'House Name', area: 'Area',
    certifyText: 'This is to certify that the above person is a registered member of this Mahallu.',
  };
  return `<main class="cert">
  <div class="frame-outer"></div><div class="frame-inner"></div>
  <div class="corner tl">${CORNER_SVG}</div><div class="corner tr">${CORNER_SVG}</div><div class="corner bl">${CORNER_SVG}</div><div class="corner br">${CORNER_SVG}</div>
  ${buildHeader(c, ml)}
  <div class="cert-title">${L.title}</div>
  <div class="cert-subtitle">${L.subtitle}</div>
  ${buildMetaRow(c, ml)}
  <div class="fields">
    <div class="field-row"><div class="field-label">${L.name}</div><div class="field-value">${esc(c.member_name || c.issued_to || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.memberCode}</div><div class="field-value">${esc(c.member_code || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.dob}</div><div class="field-value">${fmtDate(c.member_dob, ml)}</div></div>
    <div class="field-row"><div class="field-label">${L.blood}</div><div class="field-value">${esc(c.member_blood_group || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.occupation}</div><div class="field-value">${esc(c.member_occupation || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.mobile}</div><div class="field-value">${esc(c.member_mobile || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.familyNo}</div><div class="field-value">${esc(c.family_number || '—')}<span class="sub">${L.houseName}: ${esc(c.house_name || '—')}</span><span class="sub">${L.area}: ${esc(c.area || '—')}</span></div></div>
  </div>
  <div class="body-text">${L.certifyText}</div>
  ${buildSignatures(ml)}
</main>`;
}

function buildResidenceCert(c: CertData, ml: boolean): string {
  const L = ml ? {
    title: 'വസതി സർട്ടിഫിക്കറ്റ്', subtitle: 'മഹല്ല് കുടുംബ രജിസ്റ്ററിൽ രേഖപ്പെടുത്തിയത്',
    familyHead: 'കുടുംബനാഥൻ', familyNo: 'കുടുംബ നമ്പർ', houseName: 'വീട്ടുപേര്',
    houseNo: 'വീട്ടുനമ്പർ', ward: 'വാർഡ്', area: 'പ്രദേശം',
    address: 'വിലാസം', pincode: 'പിൻകോഡ്', phone: 'ഫോൺ',
    certifyText: 'മേല്പറഞ്ഞ കുടുംബം ഈ മഹല്ലിലെ രജിസ്റ്റർ ചെയ്ത വസതിയാണെന്ന് സാക്ഷ്യപ്പെടുത്തുന്നു.',
  } : {
    title: 'RESIDENCE CERTIFICATE', subtitle: 'Registered in the Mahallu Family Register',
    familyHead: 'Family Head', familyNo: 'Family No.', houseName: 'House Name',
    houseNo: 'House No.', ward: 'Ward', area: 'Area',
    address: 'Address', pincode: 'Pincode', phone: 'Phone',
    certifyText: 'This is to certify that the above family is a registered residence of this Mahallu.',
  };
  return `<main class="cert">
  <div class="frame-outer"></div><div class="frame-inner"></div>
  <div class="corner tl">${CORNER_SVG}</div><div class="corner tr">${CORNER_SVG}</div><div class="corner bl">${CORNER_SVG}</div><div class="corner br">${CORNER_SVG}</div>
  ${buildHeader(c, ml)}
  <div class="cert-title">${L.title}</div>
  <div class="cert-subtitle">${L.subtitle}</div>
  ${buildMetaRow(c, ml)}
  <div class="fields">
    <div class="field-row"><div class="field-label">${L.familyHead}</div><div class="field-value">${esc(c.issued_to || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.familyNo}</div><div class="field-value">${esc(c.family_number || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.houseName}</div><div class="field-value">${esc(c.house_name || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.houseNo}</div><div class="field-value">${esc(c.house_number || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.ward}</div><div class="field-value">${esc(c.ward || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.area}</div><div class="field-value">${esc(c.area || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.address}</div><div class="field-value">${esc(c.address || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.pincode}</div><div class="field-value">${esc(c.family_pincode || '—')}</div></div>
    <div class="field-row"><div class="field-label">${L.phone}</div><div class="field-value">${esc(c.phone || '—')}</div></div>
  </div>
  <div class="body-text">${L.certifyText}</div>
  ${buildSignatures(ml)}
</main>`;
}

function buildNocCert(c: CertData, ml: boolean): string {
  const L = ml ? {
    title: 'നികാഹിനുള്ള എതിർപ്പില്ലാ സർട്ടിഫിക്കറ്റ്', subtitle: 'No Objection Certificate for Marriage',
    groom: 'വരൻ', groomFather: 'വരന്റെ പിതാവ്', bride: 'വധു', brideFather: 'വധുവിന്റെ പിതാവ്',
    nikahDate: 'നികാഹ് തീയതി', place: 'സ്ഥലം',
    certifyText: 'മേല്പറഞ്ഞ നികാഹിന് ഈ മഹല്ല് മാനേജ്മെന്റ് കമ്മിറ്റിക്ക് യാതൊരു എതിർപ്പുമില്ലെന്ന് സാക്ഷ്യപ്പെടുത്തുന്നു.',
  } : {
    title: 'NO OBJECTION CERTIFICATE FOR MARRIAGE', subtitle: 'Mahallu Committee Clearance',
    groom: 'Bridegroom', groomFather: "Groom's Father", bride: 'Bride', brideFather: "Bride's Father",
    nikahDate: 'Proposed Date of Nikah', place: 'Place',
    certifyText: 'This is to certify that the Mahallu Management Committee has no objection to the above marriage.',
  };
  return `<main class="cert">
  <div class="frame-outer"></div><div class="frame-inner"></div>
  <div class="corner tl">${CORNER_SVG}</div><div class="corner tr">${CORNER_SVG}</div><div class="corner bl">${CORNER_SVG}</div><div class="corner br">${CORNER_SVG}</div>
  ${buildHeader(c, ml)}
  <div class="cert-title">${L.title}</div>
  <div class="cert-subtitle">${L.subtitle}</div>
  ${buildMetaRow(c, ml)}
  <div class="fields">
    <div class="field-row"><div class="field-label">${L.groom}</div><div class="field-value">${esc(c.groom_name || '—')}<span class="sub">${L.groomFather}: ${esc(c.groom_father || '—')}</span></div></div>
    <div class="field-row"><div class="field-label">${L.bride}</div><div class="field-value">${esc(c.bride_name || '—')}<span class="sub">${L.brideFather}: ${esc(c.bride_father || '—')}</span></div></div>
    <div class="field-row"><div class="field-label">${L.nikahDate}</div><div class="field-value">${fmtDate(c.nikah_date, ml)}</div></div>
    <div class="field-row"><div class="field-label">${L.place}</div><div class="field-value">${esc(c.place || '—')}</div></div>
  </div>
  <div class="body-text">${L.certifyText}</div>
  ${buildSignatures(ml)}
</main>`;
}

export function buildCertificateHtml(cert: any, lang: 'en' | 'ml' = 'en', reprintCount = 0, reprintedAt?: string, extraHeadCss?: string): string {
  const ml = lang === 'ml';
  const c = enrichCertificate(cert);
  // The official SMF death certificate is A4 LANDSCAPE; all other
  // certificates stay A4 portrait.
  const landscape = c.type === 'death';
  const css = sharedCss(ml, landscape);
  let body = '';
  switch (c.type) {
    case 'marriage': body = buildMarriageCert(c, ml); break;
    case 'death': body = buildDeathCert(c, ml); break;
    case 'membership': body = buildMembershipCert(c, ml); break;
    case 'residence': body = buildResidenceCert(c, ml); break;
    case 'noc': body = buildNocCert(c, ml); break;
    default: body = buildMembershipCert(c, ml); break; // fallback
  }
  // Anti-forgery: every certificate carries a SECURITY CODE (no QR — the
  // office or the Minz Mahallu app verifies the code against the register);
  // reprints are stamped with a small corner note (bottom-left) recording the
  // reprint date and time, so a reprint is traceable without defacing the
  // certificate.
  const reprints = Math.max(0, reprintCount || c.reprint_count || 0);
  const verifyBox = c.verification_code ? `
  <div class="verify-box">
    <div class="verify-copy">
      <span class="verify-label">${ml ? 'സുരക്ഷാ കോഡ്' : 'SECURITY CODE'}</span>
      <span class="verify-code">${esc(c.verification_code)}</span>
      <span class="verify-hint">${ml ? 'ഈ സുരക്ഷാ കോഡ് Minz Mahallu ആപ്പ് ഉപയോഗിച്ചോ മഹല്ല് ഓഫീസിലോ പരിശോധിക്കുക' : 'Verify this security code using the Minz Mahallu app or at the mahallu office'}</span>
    </div>
  </div>` : '';
  body = body.replace('</main>', `${verifyBox}</main>`);
  const reprintNote = reprints > 0
    ? `<div class="reprint-note">${ml ? 'പുനഃമുദ്രണം' : 'Reprinted on'} <b>${esc(reprintedAt || istDateTimeDm(new Date()))}</b></div>`
    : '';
  const previewCss = (extraHeadCss || '').trim()
    ? `<style data-src="templates/preview-screen.css">${extraHeadCss}</style>`
    : '';
  return `<!doctype html><html lang="${ml ? 'ml' : 'en'}"><head><meta charset="utf-8"><title>${esc(c.type)} Certificate</title><style>${css}</style>${previewCss}</head><body>${body}${reprintNote}</body></html>`;
}
