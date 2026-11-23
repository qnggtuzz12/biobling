import {requireValue,classesOf,admin,text,id} from './domain.mjs';
export async function social(path,b,user,accounts,store){
  const users=Object.values(accounts).filter(u=>u.status==='approved');
  const peers=users.filter(u=>u.id!==user.id&&(admin(user)||classesOf(u).some(c=>classesOf(user).includes(c))));
  const visible=new Set(peers.map(u=>String(u.id)));
  const me=String(user.id);
  const key=other=>[me,String(other)].sort().join('_');
  const allowed=r=>admin(user)||(r.members.includes(me)&&classesOf(user).includes(r.classId));
  if(path==='/social/list'){
    const [friends,rooms]=await Promise.all([store.get('friendships'),store.get('rooms')]);
    return {peers:peers.map(u=>({id:u.id,name:u.fullName||u.username,avatar:u.avatar||'',classIds:classesOf(u)})),friends:Object.values(friends||{}).filter(f=>f.members.includes(me)&&f.members.every(m=>m===me||visible.has(m))),rooms:Object.values(rooms||{}).filter(allowed)};
  }
  if(path==='/social/friend'){
    const other=id(String(b.userId));requireValue(visible.has(other),'Chỉ kết bạn với người cùng lớp.',403);
    await store.transaction('friendships/'+key(other),old=>{
      if(old?.accepted)return old;
      if(b.accept){requireValue(old&&old.from!==me,'Lời mời không hợp lệ.');return {...old,accepted:true};}
      return old||{members:[me,other],from:me,accepted:false};
    });return {ok:true};
  }
  if(path==='/social/create'){
    const classId=id(b.classId),members=[...new Set([me,...(b.members||[]).map(String)])];
    requireValue(members.length>=2&&members.length<=30);
    requireValue(admin(user)||classesOf(user).includes(classId),'Bạn không thuộc lớp này.',403);
    requireValue(members.every(m=>m===me||visible.has(m))&&members.every(m=>m===me||classesOf(users.find(u=>String(u.id)===m)||{}).includes(classId)),'Thành viên phải cùng lớp.',403);
    if(!b.group){requireValue(members.length===2);requireValue((await store.get('friendships/'+key(members.find(m=>m!==me))))?.accepted,'Hãy kết bạn trước khi nhắn riêng.',403);}
    const roomId=id(b.roomId);const room={id:roomId,title:text(b.title,80,true),classId,members,createdBy:me,group:!!b.group};
    await store.transaction('rooms/'+roomId,old=>{requireValue(!old,'Phòng đã tồn tại.');return room;});return {room};
  }
  const roomId=id(b.roomId),room=await store.get('rooms/'+roomId);requireValue(room&&allowed(room),'Bạn không có quyền xem cuộc trò chuyện.',403);
  if(path==='/social/send'){
    const content=text(b.content,2000,true).trim();requireValue(content.length);
    const messageId=id(b.messageId);
    await store.transaction('messages/'+roomId,old=>{old=old||{};if(old[messageId]){requireValue(old[messageId].author===me,'Tin nhắn không hợp lệ.',403);return old;}
      const latest=Object.values(old).filter(m=>m.author===me).sort((a,b)=>b.time-a.time)[0];requireValue(!latest||Date.now()-latest.time>=1500,'Bạn gửi quá nhanh.',429);
      return {...old,[messageId]:{id:messageId,author:me,name:user.fullName||user.username,content,time:Date.now()}};
    });
  }else requireValue(path==='/social/messages','Không tìm thấy thao tác.',404);
  return {messages:Object.values(await store.get('messages/'+roomId)||{}).sort((a,b)=>a.time-b.time).slice(-100).map(m=>({...m,avatar:accounts[m.author]?.avatar||''}))};
}
