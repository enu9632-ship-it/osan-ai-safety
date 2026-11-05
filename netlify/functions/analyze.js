const respond=(statusCode,data)=>({statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(data)});
const safe=(x,n=200)=>String(x??'').slice(0,n);
exports.handler=async(event)=>{
 if(event.httpMethod!=='POST')return respond(405,{error:'POST 요청만 허용합니다.'});
 if(!process.env.OPENAI_API_KEY)return respond(503,{error:'OPENAI_API_KEY 환경변수가 설정되지 않았습니다.'});
 if((event.body||'').length>3_000_000)return respond(413,{error:'요청 크기가 너무 큽니다.'});
 try{
 const body=JSON.parse(event.body||'{}');const isSummary=body.mode==='summary';
 if(!isSummary && (typeof body.image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.image)))return respond(400,{error:'올바른 카메라 이미지가 필요합니다.'});
 if(isSummary && (!Array.isArray(body.observations)||body.observations.length>90))return respond(400,{error:'관찰 기록이 필요합니다.'});
 const system=isSummary?`당신은 시민용 건축물 사전 관찰 기록을 정리하는 AI입니다. 입력된 AI 영상 관찰 기록만 종합하고 구조안전 판정을 하지 마세요. 4단계 분류는 건물 전체 안전등급이 아니라 촬영된 화면에서 보이는 위험징후의 대응 우선순위입니다. 양호=촬영한 여러 부위에서 뚜렷한 이상징후가 관찰되지 않음(안전 보증 아님), 보통=경미하거나 추가 관찰이 필요한 징후, 위험=전문가의 신속한 확인이 필요한 손상 의심, 매우위험=명백한 급박한 낙하·붕괴 등 위험 징후로 접근 회피 및 119 안내가 필요한 경우. 근거가 부족하거나 영상이 대부분 미확인일 때는 반드시 '판단 보류'. '양호'는 최소 3개 이상의 유효한 관찰 프레임과 2개 이상 구역을 확인한 경우에만 가능. 건물 전체의 내력벽 여부·균열폭 mm·법적 위반·안전 여부를 확정하지 마세요. 사용자 수기 기록은 검증된 사실이 아니므로 구분하세요. JSON만 출력: {"grade":"양호|보통|위험|매우위험|판단 보류","summary":"한국어 2~4문장","reason":"등급 근거 및 확인할 사항 2~3문장"}`:
 `당신은 시민용 건축물 위험징후 관찰 보조 AI입니다. 제공된 한 장의 카메라 이미지에 보이는 내용만 근거로 하세요. 화면에 보이는 시설물 부위를 벽체, 기둥·보, 계단실, 난간, 외벽, 옹벽, 바닥·천장, 기타, 미확인 중 하나로 식별하세요. 건물 기본정보만으로 내력벽 여부를 확정할 수 없습니다. 사진에서 보이지 않는 부분을 추정하지 마세요. 균열 폭 mm, 처짐량, 구조안전, 법규 위반을 임의로 판단하지 마세요. 뚜렷한 손상 징후가 없으면 '현재 화면에서 뚜렷한 이상 징후가 확인되지 않습니다. 안전을 보증하는 것은 아닙니다.'라고 안내하세요. 명백한 급박한 붕괴·낙하 위험 징후라면 접근 회피 및 119 신고를 권고하세요. 사람이 촬영되면 얼굴이나 개인정보는 언급하지 마세요. JSON만 출력: {"detectedArea":"벽체|기둥·보|계단실|난간|외벽|옹벽|바닥·천장|기타|미확인","visible":true,"level":"none|info|caution|urgent","message":"화면에서 보이는 징후 및 확인 방법 1~2문장 110자 이내"}. 시설물이 식별되지 않으면 visible=false, detectedArea=미확인, level=info.`;
 const input=isSummary?[{type:'text',text:JSON.stringify({observations:body.observations.slice(-50).map(o=>({area:safe(o.area,30),level:safe(o.level,15),message:safe(o.message,240),visible:!!o.visible})),areas:body.areas,manualRecords:(body.manualRecords||[]).slice(0,30),building:body.building}).slice(0,20000)}]:[{type:'text',text:'사용자가 선택한 점검 부위: '+safe(body.area,40)+'. 건물정보: '+JSON.stringify(body.building||{}).slice(0,300)+'. 실제 영상에 보이는 것만 말하세요.'},{type:'image_url',image_url:{url:body.image,detail:'high'}}];
 const resp=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini',temperature:0.1,max_tokens:isSummary?450:230,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:input}]})});
 const data=await resp.json();if(!resp.ok)throw Error(data.error?.message||'AI API 오류');
 const result=JSON.parse(data.choices?.[0]?.message?.content||'{}');
 if(isSummary){const grades=['양호','보통','위험','매우위험','판단 보류'];const valid=body.observations.filter(o=>o.visible===true);const distinct=new Set(valid.map(o=>o.area));let grade=grades.includes(result.grade)?result.grade:'판단 보류';if(grade==='양호'&&(valid.length<3||distinct.size<2))grade='판단 보류';return respond(200,{grade,summary:safe(result.summary,800),reason:safe(result.reason,800)});}
 const allowed=['벽체','기둥·보','계단실','난간','외벽','옹벽','바닥·천장','기타','미확인'];const detectedArea=allowed.includes(result.detectedArea)?result.detectedArea:'미확인';return respond(200,{detectedArea,visible:result.visible===true&&detectedArea!=='미확인',level:['none','info','caution','urgent'].includes(result.level)?result.level:'info',message:safe(result.message,350)});
 }catch(e){return respond(502,{error:'AI 처리 오류: '+safe(e.message,180)});}
};
