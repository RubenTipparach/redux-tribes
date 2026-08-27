using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class DestroyTarget : GenericMission
{

    public List<ShipController> targets;

    // Start is called before the first frame update
    void Start()
    {

    }

    // Update is called once per frame
    void Update()
    {

    }

    public override void InitializeOnAwake()
    {
        foreach (var t in targets)
        {
            t.shipFaction = GameManager.Instance.enemyFaction;
        }

    }

    public override string GenerateMissionText()
    {
        return "Destroy targets: " + string.Join(",", targets.Select(p => p.gameObject.name));
    }

    public override bool CheckMissionGoald()
    {

        foreach (var t in targets)
        {
            if (!t.Destroyed)
            {
                return false;
            }
        }

        InvokeSuccessOnce();
        return true;
        
    }
}
