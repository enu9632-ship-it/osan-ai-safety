exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return {statusCode:405,body:JSON.stringify({error:'POST 요청만 허용합니다.'})};
  if (!process.env.OPENAI_API_KEY) return {statusCode:503,body:JSON.stringify({error:'서버에 OPENAI_API_KEY가 설정되지 않았습니다.'})};
  try {
    if ((event.body||'').length > 3_000_000) return {statusCode:413,body:JSON.stringify({error:'영상 크기가 너무 큽니다.'})};
    const {image,area,building} = JSON.parse(event.body||'{}');
    if (typeof image!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)) return {statusCode:400,body:JSON.stringify({error:'올바른 카메라 이미지가 필요합니다.'})};
    const prompt = `당신은 시민용 건축물 위험징후 관찰 보조 AI입니다. 이 한 장의 사진에 실제로 보이는 사실만 설명하세요. 추측을 사실처럼 말하지 마세요. 건축물 구조 안전, 내력벽 여부, 법규 위반, 균열 폭(mm), 위험등급은 사진만으로 확정할 수 없습니다. 문제가 의심되면 위치와 형태, 추가 확인 방법, 전문가 점검 필요성을 짧게 설명하세요. 명확한 징후가 보이지 않으면 '현재 화면에서 뚜렷한 이상 징후를 확인하지 못했습니다. 안전을 보증하는 것은 아닙니다.'라고 답하세요. 긴급 낙하/붕괴 징후가 뚜렷하면 접근 금지와 119 신고를 안내하세요. 화면에 사람 얼굴/개인정보가 있어도 언급하지 마세요. 영역: ${String(area||'미상').slice(0,40)}, 건물 유형: ${String(building?.type||'미상').slice(0,60)}. JSON만 반환하세요: {"level":"none|info|caution|urgent","message":"한국어 1~2문장, 110자 이내"}`;
    const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_VISION_MODEL||'gpt-4.1-mini',temperature:0.1,max_tokens:230,response_format:{type:'json_object'},messages:[{role:'system',content:prompt},{role:'user',content:[{type:'text',text:'현재 사진에서 육안으로 확인되는 시설물 상태를 설명하세요.'},{type:'image_url',image_url:{url:image,detail:'low'}}]}]})});
    const d=await r.json();if(!r.ok)throw new Error(d.error?.message||'AI 서비스 오류');
    const result=JSON.parse(d.choices?.[0]?.message?.content||'{}');
    const level=['none','info','caution','urgent'].includes(result.level)?result.level:'info';
    const message=String(result.message||'분석 결과가 없습니다.').slice(0,400);
    return {statusCode:200,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify({level,message})};
  }catch(err){return {statusCode:502,body:JSON.stringify({error:'분석 처리 오류: '+String(err.message||err).slice(0,160)})};}
};
