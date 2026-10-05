import { NextResponse } from "next/server";
import { requireAdmin } from "../../../../../../lib/admin/auth";
import { enforceAdminRateLimit, limiterUnavailable } from "../../../../../../lib/security/rate-limit";
export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }) { const {user,admin}=await requireAdmin(); if(!user)return NextResponse.json({error:"Authentication required."},{status:401}); if(!admin)return NextResponse.json({error:"Admin access required."},{status:403}); try{const r=await enforceAdminRateLimit(request,user.id,"fulfillment-cancel",10);if(r)return r;}catch{return limiterUnavailable();} await params; return NextResponse.json({error:"ReliableSMM cancellation is not supported by the current provider abstraction."},{status:501}); }
