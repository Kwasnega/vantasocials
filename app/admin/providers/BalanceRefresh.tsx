"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export default function BalanceRefresh(){const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const router=useRouter();async function refresh(){setBusy(true);setMessage("");const r=await fetch("/api/admin/providers/reliablesmm/balance",{method:"POST"});const b=await r.json().catch(()=>({}));setMessage(r.ok?"Balance refreshed.":(b.error||"Refresh failed."));setBusy(false);if(r.ok)router.refresh();}return <div><button type="button" onClick={refresh} disabled={busy}>{busy?"Refreshing…":"Refresh balance"}</button>{message&&<small>{message}</small>}</div>}
