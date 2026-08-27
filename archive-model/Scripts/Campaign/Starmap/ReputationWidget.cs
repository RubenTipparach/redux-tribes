using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ReputationWidget : MonoBehaviour
{
    public FactionReputationUI template;

    public RectTransform factionRepPanel;
    public Dictionary<ShipFaction, FactionStatus> factionRepState;

    public void SetupFactions(){
        factionRepState = CampaignMenu.Instance.factionRepState;

        foreach(KeyValuePair<ShipFaction, FactionStatus> kvp in factionRepState)
        {
            var repUI = Instantiate(template, factionRepPanel);
            repUI.SetupFaction(CampaignMenu.Instance.factionInfoLibrary.GetFactionInfo(kvp.Key),
                kvp.Value.factionScore);
        }
    }



    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }
}
