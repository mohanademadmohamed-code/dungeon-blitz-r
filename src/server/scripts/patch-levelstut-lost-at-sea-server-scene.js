const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CLASS_NAME = 'a_Room_TutorialBoat_R01';
const DEFAULT_SWF = path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'LevelsTut.swf');
const DEFAULT_FFDEC = 'C:\\Program Files (x86)\\FFDec\\ffdec-cli.exe';
const PATCH_MARKER_NAME = 'LOST_AT_SEA_SERVER_SCENE_MARKER';
const PATCH_MARKER_VALUE = 'LostAtSeaServerSceneV4';
const LEGACY_PATCH_MARKER_VALUES = ['LostAtSeaServerSceneV1', 'LostAtSeaServerSceneV2', 'LostAtSeaServerSceneV3'];
const WORK_DIR_NAME = 'ffdec-levelstut-lost-at-sea-server-scene';

const FIELD_ANCHOR = '      public var bWaveFourActive:Boolean;';
const PATCH_FIELD_NAMES = [
  'Script_ServerPhase4',
  'Script_ServerBossIntro',
  'Script_ServerDefeatBoss',
  'Script_ServerActivePhase0',
  'Script_ServerActivePhase4',
  'Script_ServerActivePhase8',
  'Script_ServerActivePhase10',
  'serverScenePhase',
  'serverSceneElapsedSecond',
  'serverSceneAliveMask',
  'serverScenePendingElapsedSecond',
  'serverScenePendingAliveMask',
  'serverSceneAppliedPhase',
  'serverSceneAppliedSecond',
  'serverSceneAppliedAt',
  'serverSceneSnapshotRequestedAt',
  'serverScenePhase4HealthBarVisible',
  'serverScenePhase0MoveVisible',
  'serverScenePhase1Spawned',
  'serverScenePhase1RangedVisible',
  'serverScenePhase1CompletionSent',
  'serverScenePhase4BeAlertStarted',
  'serverScenePhase4MeleeVisible',
  'serverScenePhase8BossCutsceneStarted',
  'serverSceneBossIntroArmed'
];

function buildElapsedTriggerHandlers() {
  const handlers = [];
  for (let second = 0; second <= 26; second += 1) {
    handlers.push(`         if(param1.OnTrigger("LostAtSeaElapsedSecond${second}"))
         {
            this.AcceptServerElapsedSecond(${second});
         }`);
  }
  return handlers.join('\n');
}

function buildAliveMaskTriggerHandlers() {
  const handlers = [];
  for (let mask = 0; mask <= 7; mask += 1) {
    handlers.push(`         if(param1.OnTrigger("LostAtSeaAliveMask${mask}"))
         {
            this.AcceptServerAliveMask(${mask});
         }`);
  }
  return handlers.join('\n');
}

function buildPhaseTriggerHandlers() {
  const handlers = [];
  for (let phase = 0; phase <= 11; phase += 1) {
    handlers.push(`         if(param1.OnTrigger("LostAtSeaPhase${phase}"))
         {
            this.AcceptServerScenePhase(${phase});
         }`);
  }
  return handlers.join('\n');
}

const SERVER_TRIGGER_HANDLERS = [
  buildElapsedTriggerHandlers(),
  buildAliveMaskTriggerHandlers(),
  buildPhaseTriggerHandlers()
].join('\n');

const FIELD_BLOCK = `${FIELD_ANCHOR}
      
      public static const ${PATCH_MARKER_NAME}:String = "${PATCH_MARKER_VALUE}";
      
      public var Script_ServerPhase4:Array;
      
      public var Script_ServerBossIntro:Array;
      
      public var Script_ServerDefeatBoss:Array;
      
      public var Script_ServerActivePhase0:Array;
      
      public var Script_ServerActivePhase4:Array;
      
      public var Script_ServerActivePhase8:Array;
      
      public var Script_ServerActivePhase10:Array;
      
      public var serverScenePhase:int;
      
      public var serverSceneElapsedSecond:int;
      
      public var serverSceneAliveMask:int;
      
      public var serverScenePendingElapsedSecond:int;
      
      public var serverScenePendingAliveMask:int;
      
      public var serverSceneAppliedPhase:int;
      
      public var serverSceneAppliedSecond:int;
      
      public var serverSceneAppliedAt:Number;
      
      public var serverSceneSnapshotRequestedAt:Number;
      
      public var serverScenePhase4HealthBarVisible:Boolean;
      
      public var serverScenePhase0MoveVisible:Boolean;
      
      public var serverScenePhase1Spawned:Boolean;
      
      public var serverScenePhase1RangedVisible:Boolean;

      public var serverScenePhase1CompletionSent:Boolean;

      public var serverScenePhase4BeAlertStarted:Boolean;
      
      public var serverScenePhase4MeleeVisible:Boolean;
      
      public var serverScenePhase8BossCutsceneStarted:Boolean;`;

const SERVER_SCENE_METHODS = `      public function InitRoom(param1:a_GameHook) : void
      {
         this.bMoveTutorialShown = false;
         this.moveTutorialShownAt = 0;
         this.serverScenePhase = -1;
         this.serverSceneElapsedSecond = 0;
         this.serverSceneAliveMask = 0;
         this.serverScenePendingElapsedSecond = 0;
         this.serverScenePendingAliveMask = 0;
         this.serverSceneAppliedPhase = -1;
         this.serverSceneAppliedSecond = 0;
         this.serverSceneAppliedAt = 0;
         this.serverSceneSnapshotRequestedAt = -1000;
         this.serverScenePhase4HealthBarVisible = false;
         this.serverScenePhase0MoveVisible = false;
         this.serverScenePhase1Spawned = false;
         this.serverScenePhase1RangedVisible = false;
         this.serverScenePhase1CompletionSent = false;
         this.serverScenePhase4BeAlertStarted = false;
         this.serverScenePhase4MeleeVisible = false;
         this.serverScenePhase8BossCutsceneStarted = false;
         this.Script_ServerActivePhase0 = null;
         this.Script_ServerActivePhase4 = null;
         this.Script_ServerActivePhase8 = null;
         this.Script_ServerActivePhase10 = null;
         this.am_Goblin3.bHoldSpawn = true;
         this.am_Goblin4.bHoldSpawn = true;
         this.am_Goblin5.bHoldSpawn = true;
         this.am_Goblin6.bHoldSpawn = true;
         this.am_Goblin7.bHoldSpawn = true;
         this.am_Goblin8.bHoldSpawn = true;
         this.am_Goblin9.bHoldSpawn = true;
         this.am_Phage1.bHoldSpawn = true;
         this.am_Phage3.bHoldSpawn = true;
         this.am_Phage4.bHoldSpawn = true;
         this.am_Phage6.bHoldSpawn = true;
         this.am_TBack.startAnim = "Rise";
         this.am_Foreground_THEAD.am_KrakenBody.startAnim = "Rise";
         this.am_Foreground_TTAIL.am_TFrontLeft.baseAnim = "Ready2";
         this.am_Foreground_TTAIL.am_TFrontLeft.startAnim = "Rise";
         this.am_Foreground_Hump2.am_Hump2.startAnim = "Rise";
         this.am_Foreground_Hump1.am_Hump1.baseAnim = "Ready2";
         this.am_Foreground_Hump1.am_Hump1.startAnim = "Rise";
         this.am_Boss.displayName = "Colossal War Kraken";
         this.am_Boss.bHoldSpawn = true;
         param1.bBossBarOnBottom = false;
         param1.bossFightBeginsWhenThisGuyIsDead = null;
         param1.bossFightPhase = this.ServerSceneTick;
         param1.initialPhase = this.ServerSceneTick;
         param1.cutSceneStartBoss = ["9 Shake 28","0 Sound NPC_EmberExplosion 1.0","4 Parrot <Scared>^t!?","0 Fink ^t!?","4 Fink Oh no...","8 Shake 28","0 Sound NPC_EmberExplosion 1.0","5 Parrot <Panic>There it is again!","3 Parrot <Goto Red 1>","8 Fink Their Kraken...","4 Parrot <Panic> LOOK OUT!","2 Parrot <Goto Red 4>","2 End"];
         this.Script_ServerPhase4 = this.Script_BeAlert;
         this.Script_ServerBossIntro = param1.cutSceneStartBoss;
         this.Script_ServerDefeatBoss = ["8 Player I told you I'd protect your ship, Captain.","10 Fink The goblins are running for that coast.","12 Player That's the coast of Ellyria. My destination.","10 Fink What?! Ellyria was overrun by the monster hordes fifty years ago.","10 Player My orders are from the King himself.","4 Parrot <Goto Red 1>","4 Parrot I can see a village! A human village","10 Player Human survivors of the Goblin Wars? Impossible!","8 Player Head for that village, Captain.","10 Shake 60","0 Sound NPC_EmberExplosion 1.0","4 Parrot <Panic>Rocks!!!","6 Fink I see 'em. Hold on!","0 Sound FXP_BoatCrash 2.0","10 End"];
         param1.cutSceneStartBoss = null;
         param1.cutSceneDefeatBoss = null;
      }
      
      public function ServerSceneTick(param1:a_GameHook) : void
      {
${SERVER_TRIGGER_HANDLERS}
         if(getTimer() - this.serverSceneSnapshotRequestedAt >= 500)
         {
            param1.CollisionOn("LostAtSeaSyncRequest");
            this.serverSceneSnapshotRequestedAt = getTimer();
         }
         if(this.serverScenePhase >= 0 && this.serverSceneAppliedPhase != this.serverScenePhase)
         {
            this.ApplyServerScenePhase(param1,this.serverScenePhase,this.serverSceneElapsedSecond);
         }
         this.TickServerScenePhase(param1);
      }
      
      public function TickServerScenePhase(param1:a_GameHook) : void
      {
         var _loc2_:Number = this.serverSceneAppliedSecond + (getTimer() - this.serverSceneAppliedAt) / 1000;
         if(this.serverScenePhase == 0 && !this.serverScenePhase0MoveVisible && _loc2_ >= 19.5)
         {
            param1.ShowTutorial("am_HighlighterMove");
            this.serverScenePhase0MoveVisible = true;
         }
         if(this.serverScenePhase == 1)
         {
            if(!this.serverScenePhase1Spawned && _loc2_ >= 2.75)
            {
               this.SpawnServerScenePhase1();
            }
            if(!this.serverScenePhase1RangedVisible && _loc2_ >= 4.75)
            {
               param1.ShowTutorial("am_HighlighterRanged");
               this.serverScenePhase1RangedVisible = true;
            }
            if(!this.serverScenePhase1CompletionSent && this.serverScenePhase1Spawned && this.am_Phage1.Defeated())
            {
               param1.HideTutorial("am_HighlighterRanged");
               param1.CollisionOn("LostAtSeaRangedTutorialComplete");
               this.serverScenePhase1RangedVisible = false;
               this.serverScenePhase1CompletionSent = true;
            }
         }
         if(this.serverScenePhase == 4)
         {
            if(this.serverScenePhase4HealthBarVisible && _loc2_ >= 4.85)
            {
               param1.HideTutorial("am_HighlighterHealthBar");
               this.serverScenePhase4HealthBarVisible = false;
            }
            if(!this.serverScenePhase4BeAlertStarted && _loc2_ >= 4.85)
            {
               this.Script_ServerActivePhase4 = this.TrimServerSceneScript(this.Script_ServerPhase4,int(_loc2_ - 4.85));
               if(this.Script_ServerActivePhase4.length > 0)
               {
                  param1.PlayScript(this.Script_ServerActivePhase4);
               }
               this.serverScenePhase4BeAlertStarted = true;
            }
            if(!this.serverScenePhase4MeleeVisible && _loc2_ >= 22.6)
            {
               param1.ShowTutorial("am_HighlighterMelee");
               this.serverScenePhase4MeleeVisible = true;
            }
         }
         if(this.serverScenePhase == 8 && !this.serverScenePhase8BossCutsceneStarted && _loc2_ >= 2.75)
         {
            this.Script_ServerActivePhase8 = this.TrimServerSceneScript(this.Script_ServerBossIntro,int(_loc2_ - 2.75));
            if(this.Script_ServerActivePhase8.length > 0)
            {
               param1.PlayCutScene(this.Script_ServerActivePhase8);
            }
            this.serverScenePhase8BossCutsceneStarted = true;
         }
      }
      
      public function AcceptServerScenePhase(param1:int) : void
      {
         if(param1 > this.serverScenePhase)
         {
            this.serverScenePhase = param1;
            this.serverSceneElapsedSecond = this.serverScenePendingElapsedSecond;
            this.serverSceneAliveMask = this.serverScenePendingAliveMask;
         }
         else if(param1 == this.serverScenePhase)
         {
            this.serverSceneElapsedSecond = this.serverScenePendingElapsedSecond;
            this.serverSceneAliveMask = this.serverScenePendingAliveMask;
         }
      }
      
      public function AcceptServerElapsedSecond(param1:int) : void
      {
         if(param1 < 0)
         {
            param1 = 0;
         }
         if(param1 > 26)
         {
            param1 = 26;
         }
         this.serverScenePendingElapsedSecond = param1;
      }
      
      public function AcceptServerAliveMask(param1:int) : void
      {
         if(param1 < 0)
         {
            param1 = 0;
         }
         if(param1 > 7)
         {
            param1 = 7;
         }
         this.serverScenePendingAliveMask = param1;
      }
      
      public function IsServerSceneAlive(param1:int) : Boolean
      {
         return (this.serverSceneAliveMask & (1 << param1)) != 0;
      }
      
      public function TrimServerSceneScript(param1:Array, param2:int) : Array
      {
         var _loc3_:Array = [];
         var _loc4_:int = param2 * 4;
         var _loc5_:String = null;
         var _loc6_:int = 0;
         var _loc7_:int = 0;
         if(_loc4_ < 0)
         {
            _loc4_ = 0;
         }
         for each(_loc5_ in param1)
         {
            _loc6_ = _loc5_.indexOf(" ");
            _loc7_ = int(_loc6_ >= 0 ? _loc5_.substring(0,_loc6_) : _loc5_);
            if(_loc4_ > 0 && _loc7_ <= _loc4_)
            {
               _loc4_ -= _loc7_;
            }
            else if(_loc4_ > 0)
            {
               _loc3_.push(String(_loc7_ - _loc4_) + (_loc6_ >= 0 ? _loc5_.substring(_loc6_) : ""));
               _loc4_ = 0;
            }
            else
            {
               _loc3_.push(_loc5_);
            }
         }
         return _loc3_;
      }
      
      public function CancelServerSceneScripts(param1:a_GameHook) : void
      {
         param1.CancelScript(this.Script_BeAlert);
         param1.CancelScript(this.Script_OverlayDelay);
         param1.CancelScript(this.Script_OverlayDelay2);
         param1.CancelScript(this.Script_TheStorm);
         param1.CancelScript(this.Script_LookOutFliers);
         param1.CancelScript(this.Script_LooksLikeWeAreInTheClear);
         param1.CancelScript(this.Script_GoblinWait);
         param1.CancelScript(this.Script_Shootem);
         param1.CancelScript(this.Script_NicelyDone);
         param1.CancelScript(this.Script_VileSeaDemons);
         param1.CancelScript(this.Script_LookOut);
         param1.CancelScript(this.Script_GoblinWait2);
         param1.CancelScript(this.Script_ServerPhase4);
         param1.CancelScript(this.Script_ServerBossIntro);
         param1.CancelScript(this.Script_ServerDefeatBoss);
         if(this.Script_ServerActivePhase0 != null)
         {
            param1.CancelScript(this.Script_ServerActivePhase0);
         }
         if(this.Script_ServerActivePhase4 != null)
         {
            param1.CancelScript(this.Script_ServerActivePhase4);
         }
         if(this.Script_ServerActivePhase8 != null)
         {
            param1.CancelScript(this.Script_ServerActivePhase8);
         }
         if(this.Script_ServerActivePhase10 != null)
         {
            param1.CancelScript(this.Script_ServerActivePhase10);
         }
         this.Script_ServerActivePhase0 = null;
         this.Script_ServerActivePhase4 = null;
         this.Script_ServerActivePhase8 = null;
         this.Script_ServerActivePhase10 = null;
      }
      
      public function RemoveInactiveServerSceneCues(param1:int) : void
      {
         if(param1 != 1)
         {
            this.am_Phage1.Remove();
         }
         if(param1 != 2)
         {
            this.am_Phage3.Remove();
         }
         if(param1 != 3)
         {
            this.am_Phage4.Remove();
            this.am_Phage6.Remove();
         }
         if(param1 != 5)
         {
            this.am_Goblin3.Remove();
         }
         if(param1 != 6)
         {
            this.am_Goblin4.Remove();
            this.am_Goblin5.Remove();
            this.am_Goblin6.Remove();
         }
         if(param1 != 7)
         {
            this.am_Goblin7.Remove();
            this.am_Goblin8.Remove();
            this.am_Goblin9.Remove();
         }
         if(param1 != 9)
         {
            this.am_Boss.Remove();
         }
      }
      
      public function RemoveServerSceneDecorativeBoarders() : void
      {
         this.am_Goblin0.Remove();
         this.am_Goblin1.Remove();
         this.am_Goblin2.Remove();
         this.am_GStub1.Remove();
         this.am_GStub2.Remove();
         this.am_GStub3.Remove();
         this.am_GStub4.Remove();
         this.am_GStub5.Remove();
      }
      
      public function ResetServerScenePhaseFlags() : void
      {
         this.serverScenePhase4HealthBarVisible = false;
         this.serverScenePhase0MoveVisible = false;
         this.serverScenePhase1Spawned = false;
         this.serverScenePhase1RangedVisible = false;
         this.serverScenePhase1CompletionSent = false;
         this.serverScenePhase4BeAlertStarted = false;
         this.serverScenePhase4MeleeVisible = false;
         this.serverScenePhase8BossCutsceneStarted = false;
      }
      
      public function SpawnServerScenePhase1() : void
      {
         if(!this.IsServerSceneAlive(0))
         {
            return;
         }
         this.am_Phage1.Spawn();
         this.am_Phage1.Goto("Red 5");
         this.am_Phage1.DeepSleep();
         this.serverScenePhase1Spawned = true;
      }
      
      public function ApplyServerScenePhase(param1:a_GameHook, param2:int, param3:int) : void
      {
         this.CancelServerSceneScripts(param1);
         this.RemoveInactiveServerSceneCues(param2);
         this.ResetServerScenePhaseFlags();
         param1.HideTutorial("am_HighlighterMove");
         param1.HideTutorial("am_HighlighterRanged");
         param1.HideTutorial("am_HighlighterHealthBar");
         param1.HideTutorial("am_HighlighterMelee");
         if(param2 >= 5)
         {
            this.RemoveServerSceneDecorativeBoarders();
         }
         if(param2 >= 8)
         {
            param1.bossFightBeginsWhenThisGuyIsDead = null;
            this.am_LastMonster.Remove();
         }
         if(param2 == 0)
         {
            param1.Animate("am_Tint","Off");
            this.Script_ServerActivePhase0 = this.TrimServerSceneScript(this.Script_TheStorm,param3);
            if(this.Script_ServerActivePhase0.length > 0)
            {
               param1.PlayScript(this.Script_ServerActivePhase0);
            }
            if(param3 >= 20)
            {
               param1.ShowTutorial("am_HighlighterMove");
               this.serverScenePhase0MoveVisible = true;
            }
         }
         else if(param2 == 1)
         {
            if(param3 < 3)
            {
               this.Script_ServerActivePhase0 = this.TrimServerSceneScript(this.Script_LookOutFliers,param3);
               if(this.Script_ServerActivePhase0.length > 0)
               {
                  param1.PlayScript(this.Script_ServerActivePhase0);
               }
            }
            if(param3 >= 3)
            {
               this.SpawnServerScenePhase1();
            }
            if(param3 >= 5)
            {
               param1.ShowTutorial("am_HighlighterRanged");
               this.serverScenePhase1RangedVisible = true;
            }
         }
         else if(param2 == 2)
         {
            param1.PlayScript(this.Script_LookOut);
            if(this.IsServerSceneAlive(0))
            {
               this.am_Phage3.Spawn();
               this.am_Phage3.Goto("Red 7");
            }
         }
         else if(param2 == 3)
         {
            param1.PlayScript(this.Script_VileSeaDemons);
            if(this.IsServerSceneAlive(0))
            {
               this.am_Phage4.Spawn();
               this.am_Phage4.Goto("Red 5");
            }
            if(this.IsServerSceneAlive(1))
            {
               this.am_Phage6.Spawn();
               this.am_Phage6.Goto("Red 6");
            }
         }
         else if(param2 == 4)
         {
            if(param3 < 5)
            {
               this.Script_ServerActivePhase4 = this.TrimServerSceneScript(this.Script_NicelyDone,param3);
               if(this.Script_ServerActivePhase4.length > 0)
               {
                  param1.PlayScript(this.Script_ServerActivePhase4);
               }
               param1.ShowTutorial("am_HighlighterHealthBar");
               this.serverScenePhase4HealthBarVisible = true;
            }
            else
            {
               this.Script_ServerActivePhase4 = this.TrimServerSceneScript(this.Script_ServerPhase4,param3 - 5);
               if(this.Script_ServerActivePhase4.length > 0)
               {
                  param1.PlayScript(this.Script_ServerActivePhase4);
               }
               this.serverScenePhase4BeAlertStarted = true;
            }
            if(param3 >= 23)
            {
               param1.ShowTutorial("am_HighlighterMelee");
               this.serverScenePhase4MeleeVisible = true;
            }
         }
         else if(param2 == 5)
         {
            if(this.IsServerSceneAlive(0))
            {
               this.am_Goblin3.Spawn();
            }
            param1.ShowTutorial("am_HighlighterMelee");
         }
         else if(param2 == 6)
         {
            if(this.IsServerSceneAlive(0))
            {
               this.am_Goblin4.Spawn();
            }
            if(this.IsServerSceneAlive(1))
            {
               this.am_Goblin5.Spawn();
            }
            if(this.IsServerSceneAlive(2))
            {
               this.am_Goblin6.Spawn();
            }
         }
         else if(param2 == 7)
         {
            if(this.IsServerSceneAlive(0))
            {
               this.am_Goblin7.Spawn();
            }
            if(this.IsServerSceneAlive(1))
            {
               this.am_Goblin8.Spawn();
            }
            if(this.IsServerSceneAlive(2))
            {
               this.am_Goblin9.Spawn();
            }
         }
         else if(param2 == 8)
         {
            if(param3 < 3)
            {
               this.Script_ServerActivePhase8 = this.TrimServerSceneScript(this.Script_LooksLikeWeAreInTheClear,param3);
               if(this.Script_ServerActivePhase8.length > 0)
               {
                  param1.PlayScript(this.Script_ServerActivePhase8);
               }
            }
            else
            {
               this.Script_ServerActivePhase8 = this.TrimServerSceneScript(this.Script_ServerBossIntro,param3 - 3);
               if(this.Script_ServerActivePhase8.length > 0)
               {
                  param1.PlayCutScene(this.Script_ServerActivePhase8);
               }
               this.serverScenePhase8BossCutsceneStarted = true;
            }
         }
         else if(param2 == 9)
         {
            param1.PlayCutScene(["0 End"]);
            if(this.IsServerSceneAlive(0))
            {
               this.am_Boss.Spawn();
            }
            param1.Animate("am_KrakenBody","Rise",false);
            param1.Animate("am_TBack","Rise",false);
            param1.Animate("am_TFrontLeft","Rise",false);
            param1.Animate("am_Hump1","Rise",false);
            param1.Animate("am_Hump2","Rise",false);
            if(param3 <= 0)
            {
               param1.PlaySound("NPC_Boss_Kraken_Smash",2);
            }
         }
         else if(param2 == 10)
         {
            param1.Animate("am_KrakenBody","KO",true);
            param1.Animate("am_TBack","KO",true);
            param1.Animate("am_TFrontLeft","KO",true);
            param1.Animate("am_Hump1","KO",true);
            param1.Animate("am_Hump2","KO",true);
            this.Script_ServerActivePhase10 = this.TrimServerSceneScript(this.Script_ServerDefeatBoss,param3);
            if(this.Script_ServerActivePhase10.length > 0)
            {
               param1.PlayCutScene(this.Script_ServerActivePhase10);
            }
         }
         else if(param2 == 11)
         {
            param1.PlayCutScene(["0 End"]);
            param1.ShowTutorial("am_WhiteOut");
         }
         this.serverSceneAppliedPhase = param2;
         this.serverSceneAppliedSecond = param3;
         this.serverSceneAppliedAt = getTimer();
      }
      `;

function parseArgs(argv) {
  const args = { swf: DEFAULT_SWF, ffdec: '', verify: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--swf') args.swf = argv[++index] || args.swf;
    else if (arg === '--ffdec' || arg === '-f') args.ffdec = argv[++index] || '';
    else if (arg === '--verify') args.verify = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function resolveCandidate(root, candidate) {
  if (!candidate) return '';
  return path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
}

function detectFfdec(root, preferred) {
  const candidates = [
    resolveCandidate(root, preferred),
    DEFAULT_FFDEC,
    path.join(root, 'build', 'tools', 'ffdec_25.0.0', 'ffdec-cli.jar'),
    '/Applications/FFDec.app/Contents/Resources/ffdec.sh'
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate));
}

function runFfdec(ffdec, args) {
  if (ffdec.toLowerCase().endsWith('.jar')) {
    execFileSync('java', ['-jar', ffdec, '-cli', ...args], { stdio: 'inherit' });
    return;
  }
  execFileSync(ffdec, ['-cli', ...args], { stdio: 'inherit' });
}

function assertBuildWorkDir(root, workDir) {
  const buildRoot = `${path.resolve(root, 'build')}${path.sep}`.toLowerCase();
  const resolvedWork = path.resolve(workDir).toLowerCase();
  if (!resolvedWork.startsWith(buildRoot)) {
    throw new Error(`Refusing to replace non-build work directory: ${workDir}`);
  }
}

function exportRoom(ffdec, root, workDir, swf) {
  assertBuildWorkDir(root, workDir);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  runFfdec(ffdec, ['-selectclass', CLASS_NAME, '-export', 'script', workDir, swf]);
  const sourcePath = path.join(workDir, 'scripts', `${CLASS_NAME}.as`);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing FFDec export: ${sourcePath}`);
  return sourcePath;
}

function countOccurrences(source, value) {
  return source.split(value).length - 1;
}

function verifySource(source) {
  const requiredSnippets = [
    `public static const ${PATCH_MARKER_NAME}:String = "${PATCH_MARKER_VALUE}";`,
    'public function ServerSceneTick(param1:a_GameHook) : void',
    'public function TickServerScenePhase(param1:a_GameHook) : void',
    'public function AcceptServerScenePhase(param1:int) : void',
    'public function AcceptServerElapsedSecond(param1:int) : void',
    'public function AcceptServerAliveMask(param1:int) : void',
    'public function TrimServerSceneScript(param1:Array, param2:int) : Array',
    'public function ApplyServerScenePhase(param1:a_GameHook, param2:int, param3:int) : void',
    'public function RemoveInactiveServerSceneCues(param1:int) : void',
    'public function RemoveServerSceneDecorativeBoarders() : void',
    'public function SpawnServerScenePhase1() : void',
    'param1.initialPhase = this.ServerSceneTick;',
    'param1.CollisionOn("LostAtSeaSyncRequest");',
    'if(param1 > this.serverScenePhase)',
    'var _loc4_:int = param2 * 4;',
    'this.Script_ServerPhase4 = this.Script_BeAlert;',
    'this.Script_ServerBossIntro = param1.cutSceneStartBoss;',
    'param1.bossFightBeginsWhenThisGuyIsDead = null;',
    'param1.cutSceneStartBoss = null;',
    'this.ApplyServerScenePhase(param1,this.serverScenePhase,this.serverSceneElapsedSecond);',
    'this.TickServerScenePhase(param1);',
    'param1.CollisionOn("LostAtSeaRangedTutorialComplete");',
    'this.am_Phage1.Spawn();',
    'this.am_Phage3.Spawn();',
    'this.am_Phage4.Spawn();',
    'this.am_Phage6.Spawn();',
    'this.am_Goblin3.Spawn();',
    'this.am_Goblin4.Spawn();',
    'this.am_Goblin5.Spawn();',
    'this.am_Goblin6.Spawn();',
    'this.am_Goblin7.Spawn();',
    'this.am_Goblin8.Spawn();',
    'this.am_Goblin9.Spawn();',
    'this.am_Boss.Spawn();',
    'param1.PlayCutScene(this.Script_ServerActivePhase8);',
    'param1.PlayCutScene(this.Script_ServerActivePhase10);',
    'param1.CancelScript(this.Script_ServerBossIntro);',
    'param1.CancelScript(this.Script_ServerDefeatBoss);',
    'param1.PlayCutScene(["0 End"]);'
  ];
  for (let second = 0; second <= 26; second += 1) {
    requiredSnippets.push(`param1.OnTrigger("LostAtSeaElapsedSecond${second}")`);
  }
  for (let mask = 0; mask <= 7; mask += 1) {
    requiredSnippets.push(`param1.OnTrigger("LostAtSeaAliveMask${mask}")`);
  }
  for (let phase = 0; phase <= 11; phase += 1) {
    requiredSnippets.push(`param1.OnTrigger("LostAtSeaPhase${phase}")`);
  }
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) throw new Error(`Lost at Sea patch verification failed; missing: ${snippet}`);
  }
  if (countOccurrences(source, PATCH_MARKER_VALUE) !== 1) {
    throw new Error(`Lost at Sea patch marker count is not one: ${countOccurrences(source, PATCH_MARKER_VALUE)}`);
  }
  for (const legacyMarker of LEGACY_PATCH_MARKER_VALUES) {
    if (source.includes(legacyMarker)) {
      throw new Error(`Legacy Lost at Sea marker remains after the V4 upgrade: ${legacyMarker}`);
    }
  }
  if (source.includes('param1.initialPhase = this.FirstTickRoom;')) {
    throw new Error('Legacy client-owned TutorialBoat initial phase is still active');
  }
  if (source.includes('param1.PlayCutScene(this.Script_ServerDefeatBoss);')) {
    throw new Error('Phase 10 still restarts the complete defeat cutscene');
  }
  if (source.includes('serverSceneBossIntroArmed')) {
    throw new Error('Legacy automatic boss intro latch remains active');
  }
  if (source.includes('if(param2 >= 4)')) {
    throw new Error('Goblin intermission removes its decorative actors before their cutscene finishes');
  }
  if (!source.includes('if(param2 >= 5)')) {
    throw new Error('Lost at Sea patch does not retire decorative boarders at the first combat goblin wave');
  }
  if (source.includes('param1.PlayCutScene(["0 End"]);\\n            this.Script_ServerActivePhase8')) {
    throw new Error('Phase 8 still clears the cutscene immediately before starting the boss intro');
  }
  if (source.includes('else if(param2 == 10)\\n         {\\n            param1.PlayCutScene(["0 End"]);')) {
    throw new Error('Phase 10 still clears the cutscene immediately before starting the outro');
  }
}

function stripPatchDeclarations(source) {
  let stripped = source.replace(
    new RegExp(`\\s*public static const ${PATCH_MARKER_NAME}:String = "(?:${[PATCH_MARKER_VALUE, ...LEGACY_PATCH_MARKER_VALUES].join('|')})";\\s*`),
    '\n      '
  );
  for (const fieldName of PATCH_FIELD_NAMES) {
    stripped = stripped.replace(
      new RegExp(`\\r?\\n\\s*public var ${fieldName}:[^;]+;`, 'g'),
      ''
    );
  }
  return stripped;
}

function patchSource(source) {
  if (source.includes(PATCH_MARKER_VALUE)) {
    verifySource(source);
    return { source, changed: false };
  }
  if (!source.includes('public dynamic class a_Room_TutorialBoat_R01 extends MovieClip')) {
    throw new Error('Unexpected TutorialBoat room class');
  }
  if (!source.includes(FIELD_ANCHOR)) {
    throw new Error('TutorialBoat field anchor changed');
  }
  const upgradingLegacy = LEGACY_PATCH_MARKER_VALUES.some((marker) => source.includes(marker));
  if (!upgradingLegacy && !source.includes('param1.initialPhase = this.FirstTickRoom;')) {
    throw new Error('TutorialBoat legacy initial phase changed');
  }

  let patched = stripPatchDeclarations(source);
  patched = patched.replace(FIELD_ANCHOR, FIELD_BLOCK);
  const initPattern = /      public function InitRoom\(param1:a_GameHook\) : void\s*\{[\s\S]*?\n      \}\s*\n\s*public function FirstTickRoom/;
  if (!initPattern.test(patched)) {
    throw new Error('TutorialBoat InitRoom block could not be located');
  }
  patched = patched.replace(initPattern, `${SERVER_SCENE_METHODS}\n      public function FirstTickRoom`);
  verifySource(patched);
  return { source: patched, changed: true };
}

function main() {
  const args = parseArgs(process.argv);
  const root = repoRoot();
  const swf = path.resolve(root, args.swf);
  const ffdec = detectFfdec(root, args.ffdec);
  if (!fs.existsSync(swf)) throw new Error(`LevelsTut SWF not found: ${swf}`);
  if (!ffdec) throw new Error('FFDec not found; pass --ffdec <path>');

  const suffix = args.verify ? '-verify' : '';
  const work = path.join(root, 'build', `${WORK_DIR_NAME}${suffix}`);
  const sourcePath = exportRoom(ffdec, root, work, swf);
  const originalSource = fs.readFileSync(sourcePath, 'utf8');

  if (args.verify) {
    verifySource(originalSource);
    console.log('[LostAtSeaServerScene] verified V4 elapsed/mask monotonic server scene consumer');
    return;
  }

  const patchResult = patchSource(originalSource);
  if (!patchResult.changed) {
    console.log('[LostAtSeaServerScene] patch already present and verified');
    return;
  }

  fs.writeFileSync(sourcePath, patchResult.source, 'utf8');
  const patchedSwf = path.join(work, 'LevelsTut.patched.swf');
  runFfdec(ffdec, ['-importScript', swf, patchedSwf, path.dirname(sourcePath)]);
  if (!fs.existsSync(patchedSwf)) throw new Error(`FFDec did not create patched SWF: ${patchedSwf}`);

  const roundTripWork = `${work}-roundtrip`;
  const roundTripSource = exportRoom(ffdec, root, roundTripWork, patchedSwf);
  verifySource(fs.readFileSync(roundTripSource, 'utf8'));

  fs.copyFileSync(patchedSwf, swf);
  const finalVerifyWork = `${work}-final-verify`;
  const finalSource = exportRoom(ffdec, root, finalVerifyWork, swf);
  verifySource(fs.readFileSync(finalSource, 'utf8'));
  console.log('[LostAtSeaServerScene] rebuilt LevelsTut.swf and round-trip verified the V4 elapsed/mask server scene consumer');
}

main();
