// A suspended viewer keeps scene state; only the drawing loop is stopped.
export function createViewerActivity({start,stop}){
 let running=false;
 return {sync({hidden=false,lost=false,visible=true}={}){const next=!hidden&&!lost&&visible;if(next===running)return;running=next;if(next)start();else stop();},dispose(){if(running)stop();running=false;}};
}
