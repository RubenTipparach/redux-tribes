using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class FactionReputationUI : MonoBehaviour
{

    public FactionInfo factionInfo;

    public int reputationValue;
    // to do add name label to when you hover over this.
    public Image factionFlag;
    public Image badRepSlice;
    public Image goodRepSlice;

    public void SetupFaction(FactionInfo faction, int repValue){
        reputationValue = repValue;
        if(reputationValue == 0)
        {
            badRepSlice.fillAmount = 0;
            goodRepSlice.fillAmount = 0;
        }
        else if(reputationValue > 0) {
            badRepSlice.fillAmount = 0;
            goodRepSlice.fillAmount = repValue / 100f;
        }
        else if(reputationValue < 0) {
            badRepSlice.fillAmount = Mathf.Abs(repValue)/ 100f;
            goodRepSlice.fillAmount = 0;
        }

        factionInfo = faction;
        factionFlag.sprite = factionInfo.factionIcon;
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

