try {
  app.open(File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/project.aep"));
  var log = "items="+app.project.numItems+"\n";
  for (var i=1;i<=app.project.numItems;i++){
    var it=app.project.item(i);
    if (it instanceof CompItem){
      log+="COMP\t"+it.name+"\t"+it.width+"x"+it.height+"\t"+it.duration.toFixed(2)+"s\tlayers="+it.numLayers+"\n";
      for (var j=1;j<=it.numLayers;j++){
        var ly=it.layer(j); var t="";
        try { if (ly.property("Source Text")!=null) t=" [TEXT: "+ly.property("Source Text").value.text.substr(0,30)+"]"; } catch(e){}
        log+="  L"+j+"\t"+ly.name+t+"\n";
      }
    }
  }
  var f=new File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/inspect.txt");
  f.open("w"); f.write(log); f.close();
} catch(err){
  var f2=new File("C:/Users/PC/Shorts_Generator_2026/ae-work/m06/inspect.txt");
  f2.open("w"); f2.write("ERROR: "+err.toString()); f2.close();
}
