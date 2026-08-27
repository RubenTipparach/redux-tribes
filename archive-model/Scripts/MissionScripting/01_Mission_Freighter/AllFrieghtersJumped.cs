using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;
using Unity.VisualScripting;

public class AllFrieghtersJumped : GenericMission
{
    public string missionTextTemplate = "At least <b>one</b> freighter must survive and leave area.";

    public List<ShipController> freighters;

    public override string GenerateMissionText()
    {
        return missionTextTemplate;
    }

    public override bool CheckMissionGoald()
    {
        var frieghtersAlive = freighters.Where(p => !p.Destroyed).ToArray();
        if (frieghtersAlive.Length == 0)
        {
            onFailedEvent?.Invoke();
            //Debug.LogError("all freighters destroyed");
            return false;
        }else{
            //Debug.LogError("still freighters left");
        }

        // if all freighters alive jumped and some still alive, we win.
        if (frieghtersAlive.Where(p => !p.jumped).Count() > 0)
        {
            return false;
        }
        else
        {
            onSuccessEvent?.Invoke();
            return true;
        }
    }

    public void FreighterJumped(GameObject jumpedShip)
    {
        var freighter = jumpedShip.GetComponent<ShipController>();
        if(freighter != null && freighters.Contains(freighter)){
            freighter.jumped = true;
            //freighters.Remove(freighter);
            freighter.gameObject.SetActive(false);// do fancy stuff later lol.
        }
    }
}
