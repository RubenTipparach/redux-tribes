using System.Collections;
using System.Collections.Generic;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

public class BoardingPartyUI : MonoBehaviour
{
    public Slider defenderLeftSlider;
    public Slider attackerRightSlider;

    public TextMeshProUGUI defenderLeftCount;
    public TextMeshProUGUI attackeRightCount;

    public Image factionImage;

    public ShipFaction faction = ShipFaction.None;

    public void UpdateAttackDefenseStatus(int defenders, int attackers, ShipFaction controllingFaction){
        if(faction != controllingFaction)
        {
            faction = controllingFaction;
            factionImage.sprite = GameManager.Instance.factionInfoLibrary.GetFactionInfo(faction).factionIcon;
        }

        int total = defenders + attackers;

        defenderLeftSlider.value = (float)defenders / total;
        attackerRightSlider.value = (float)attackers / total;

        defenderLeftCount.text = defenders.ToString();
        attackeRightCount.text = attackers.ToString();
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
