using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class StarportPanel : MonoBehaviour, ICampaignPanel
{
    public void Close()
    {
        gameObject.SetActive(false);
    }

    public ICampaignPanel Open()
    {
        gameObject.SetActive(true);
        return this;
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
