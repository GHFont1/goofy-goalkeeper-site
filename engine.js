(function(root){
'use strict';
class Match {
 constructor(random=Math.random){this.random=random;this.reset();}
 reset(practice=false){Object.assign(this,{practice,time:60,elapsed:0,score:0,streak:0,saves:0,misses:0,boots:0,stars:0,items:[],spawnIn:.8,over:false,player:.5,nextId:0});}
 get multiplier(){return Math.min(4,1+Math.floor(this.streak/5));}
 spawn(){const r=this.random();this.items.push({id:this.nextId++,x:.08+this.random()*.84,y:-.1,type:r<.15?'boot':r<.23?'star':'ball',speed:.30+Math.min(.25,this.elapsed*.0025)+this.random()*.08,spin:this.random()*6});}
 step(dt){if(this.over)return [];dt=Math.min(.05,Math.max(0,dt));const events=[];this.elapsed+=dt;if(!this.practice){this.time=Math.max(0,60-this.elapsed);if(this.time<=0){this.over=true;return [{type:'end'}];}}
 this.spawnIn-=dt;if(this.spawnIn<=0){this.spawn();this.spawnIn=Math.max(.40,.88-this.elapsed*.005);}
 for(const item of this.items){const before=item.y;item.y+=item.speed*dt;item.spin+=dt*2;if(before<.84&&item.y>=.84){const caught=Math.abs(item.x-this.player)<=.135;if(caught){if(item.type==='ball'){this.streak++;this.saves++;const points=this.multiplier;this.score+=points;events.push({type:'save',points,x:item.x});}else if(item.type==='star'){this.stars++;const points=5*this.multiplier;this.score+=points;events.push({type:'star',points,x:item.x});}else{this.boots++;this.streak=0;this.score=Math.max(0,this.score-3);events.push({type:'boot',x:item.x});}item.dead=true;}else if(item.type==='ball'){this.misses++;this.streak=0;events.push({type:'miss',x:item.x});}}}
 this.items=this.items.filter(i=>!i.dead&&i.y<1.15);return events;
 }
}
if(typeof module!=='undefined')module.exports={Match};else root.GoofyMatch=Match;
})(typeof window!=='undefined'?window:globalThis);
