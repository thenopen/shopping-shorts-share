function log(s){var f=new File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/render.txt");f.open("a");f.write(s+"\n");f.close();}
try{
  (new File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/render.txt")).remove();
}catch(e){}
try{
  app.open(File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/project.aep"));
  var comp=null;
  for(var i=1;i<=app.project.numItems;i++){var it=app.project.item(i);if(it instanceof CompItem){comp=it;break;}}
  log("comp="+comp.name);
  for(var j=1;j<=comp.numLayers;j++){var ly=comp.layer(j);try{var st=ly.property("Source Text");if(st!=null){var d=st.value;d.text="지금 3만원대 실화냐";st.setValue(d);log("set text on "+ly.name);}}catch(e){}}
  var rq=app.project.renderQueue;
  var item=rq.items.add(comp);
  var om=item.outputModule(1);
  var tpls=om.templates.join(",");
  log("templates="+tpls.substr(0,300));
  var picked="";
  var want=["알파 포함 무손실","고품질(알파 포함)","알파가 포함된 TIFF 시퀀스"];
  for(var k=0;k<want.length;k++){ for(var t=0;t<om.templates.length;t++){ if(om.templates[t]==want[k]){picked=want[k];break;} } if(picked)break; }
  if(picked){om.applyTemplate(picked);log("applied="+picked);} else log("no alpha template found");
  om.file=new File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/out.mov");
  log("rendering...");
  rq.render();
  log("DONE rc");
}catch(err){log("ERROR: "+err.toString()+" line "+err.line);}
